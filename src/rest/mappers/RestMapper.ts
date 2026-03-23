import {
  AppTypes,
  LogEvent,
  LogLevel,
  LogCategory,
  RestDetails,
  NormalizedLogData,
} from "@/types";
import { LogMapper } from "@/common/mappers/BaseMapper";
import { buildEventId } from "@/utils/mapper";
import { REST_ACTION_MAP } from "../constants/RestActions";

export class RestMapper implements LogMapper {
  /**
   * Identifies if the log belongs to the REST/SDK flow or is an internal Laravel trace.
   */
  canHandle(data: NormalizedLogData): boolean {
    const msg = String(data.message || "");
    const context = data.context as Record<string, unknown>;
    const isLaravelFile = String(context?.filePath || "").includes("laravel.log");
    const hasLaravelPattern =
      /production\.(INFO|ALERT|WARNING|CRITICAL|ERROR|NOTICE|DEBUG)/.test(msg);

    return !!(
      data.sourceType === "NEW_RELIC_JSON" ||
      isLaravelFile ||
      hasLaravelPattern ||
      msg.includes("RestSdk") ||
      msg.includes("INTERDIN")
    );
  }

  isMatch(event: LogEvent, targetId: string): boolean {
    const details = event.details as RestDetails;
    const tId = String(targetId).toLowerCase();
    const payload = (details?.payload as Record<string, unknown>) || {};

    return (
      String(event.id).toLowerCase() === tId ||
      String(details?.awsRequestId).toLowerCase() === tId ||
      String((event.context as Record<string, unknown>)?.messageId).toLowerCase() === tId ||
      // Search by Hash ID (Interdin Case)
      String(payload?.id || "")
        .toLowerCase()
        .includes(tId) ||
      String(payload?.reference || "")
        .toLowerCase()
        .includes(tId) ||
      String(payload?.bin || "").includes(tId)
    );
  }

  map(data: NormalizedLogData, _rawLine: string, index: number): LogEvent {
    const msgRaw = data.message;
    const nrContext = (data.context || {}) as Record<string, unknown>;

    // 1. EXTRACT INTERNAL JSON (Handles truncated and multi-block)
    const internalData = this.parseInternalJson(msgRaw) as Record<string, any>;

    // 2. ORIGIN DETECTION AND BASIC METADATA
    const isLaravelLog = msgRaw.includes("production.");
    let displayMessage = "";

    // Dynamic provider extraction
    const provider = String(
      internalData?.provider ||
      internalData?.TENANT_DOMAIN ||
      internalData?.service ||
      (isLaravelLog ? "LARAVEL" : "API_REST")
    );

    const operation = String(
      internalData?.operation || (isLaravelLog ? "System Log" : "API Operation")
    );

    // 3. ENDPOINT EXTRACTION
    const extractedEndpoint = String(
      internalData?.context?.endpoint ||
      internalData?.endpoint ||
      nrContext.filePath ||
      "unknown"
    );

    const extractedMethod = String(
      internalData?.context?.method || (isLaravelLog ? "DEBUG" : "POST")
    );

    let category: LogCategory = "BACKEND_LOG";

    if (isLaravelLog) {
      // --- LARAVEL.LOG PROCESSING ---
      category = "APPLICATION_LOG";
      const parts = msgRaw.split("production.");
      if (parts[1]) {
        const levelAndMsg = parts[1].split(": ");
        const messageWithJson = levelAndMsg[1] || "";
        const jsonStart = messageWithJson.indexOf("{");
        displayMessage =
          jsonStart !== -1
            ? messageWithJson.substring(0, jsonStart).trim()
            : messageWithJson.trim();
      }
    } else {
      // --- SDK / API PROCESSING ---
      const action = String(internalData?.action || "N/A");
      category = action.toLowerCase().includes("request")
        ? "HTTP_REQ_OUT"
        : "HTTP_RES";

      const knownAction = REST_ACTION_MAP[operation];
      displayMessage = knownAction ? knownAction.message : operation;

      // Enriched title for the Timeline
      displayMessage += ` | ${action.toUpperCase().replace("-", " ")}`;

      // Response metadata
      const body =
        internalData?.context?.data?.dinBody || internalData?.data?.dinBody;
      if (body?.numeroRegistros > 0 && category === "HTTP_RES") {
        displayMessage += ` (${body.numeroRegistros} records)`;
      }
    }

    // 4. STATUS AND ERROR MANAGEMENT
    const exception =
      internalData?.context?.exception ||
      nrContext?.exception ||
      internalData?.exception;
    const bizError =
      internalData?.context?.data?.dinError ||
      internalData?.error ||
      internalData?.data?.dinError;
    let statusCode: number | string | null = null;

    if (exception) {
      category = "ERROR";
      const codeMatch = String(exception.message || "").match(/`(\d{3})`/);
      statusCode = codeMatch ? codeMatch[1] : 500;
      displayMessage = `Critical Failure [${provider}]: ${String(
        exception.message || ""
      ).substring(0, 60)}...`;
    } else if (bizError && bizError.codigo && bizError.codigo !== "0000") {
      category = "ERROR";
      statusCode = bizError.codigo;
      displayMessage = `${provider} | Error ${statusCode}: ${
        bizError.mensaje || "Failed Op."
      }`;
    } else {
      statusCode = category === "HTTP_RES" ? 200 : null;
    }

    // 5. DETAILS CONSTRUCTION
    const details: RestDetails = {
      provider,
      operation: internalData?.reference
        ? `REF: ${internalData.reference}`
        : operation,
      action: String(internalData?.action || (isLaravelLog ? "LOG_EVENT" : "N/A")),
      method: extractedMethod,
      endpoint: extractedEndpoint,
      statusCode,
      awsRequestId: String(nrContext.messageId || internalData?.id || ""),
      payload: internalData || { raw: msgRaw },
      exception: exception as Record<string, unknown> | undefined,
      source: "BACKEND",
      isLaravel: isLaravelLog,
    };

    return {
      id: buildEventId(nrContext, index),
      timestamp: data.timestamp,
      level: (category === "ERROR" ? "ERROR" : data.level) as LogLevel,
      message: displayMessage || "Trace event",
      category,
      appType: AppTypes.REST,
      details,
      context: nrContext,
      rawStream: msgRaw.slice(0, 250),
    };
  }

  /**
   * Advanced parser that repairs JSON and cleans double blocks.
   */
  private parseInternalJson(message: string): unknown {
    if (typeof message !== "string") return null;
    const jsonStart = message.indexOf("{");
    if (jsonStart === -1) return null;

    let rawJson = message.substring(jsonStart).trim();

    if (rawJson.includes("(truncated...)")) {
      rawJson = rawJson.split("(truncated...)")[0].trim();
    }

    if (rawJson.includes("} {")) {
      rawJson = rawJson.split("} {")[0] + "}";
    }

    try {
      return JSON.parse(rawJson);
    } catch {
      return this.tryFixTruncatedJson(rawJson);
    }
  }

  private tryFixTruncatedJson(jsonStr: string): unknown {
    try {
      let fixed = jsonStr;
      const openBraces = (fixed.match(/\{/g) || []).length;
      const closeBraces = (fixed.match(/\}/g) || []).length;
      if (openBraces > closeBraces) {
        fixed += "}".repeat(openBraces - closeBraces);
      }
      return JSON.parse(fixed);
    } catch {
      return null;
    }
  }
}
