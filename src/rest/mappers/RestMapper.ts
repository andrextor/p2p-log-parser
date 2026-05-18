import { RAW_STREAM_MAX_LENGTH } from "@/common/constants";
import type { LogMapper } from "@/common/mappers/BaseMapper";
import {
  AppTypes,
  type LogCategory,
  type LogEvent,
  type LogLevel,
  type NormalizedLogData,
  type RestDetails,
} from "@/types";
import { buildEventId } from "@/utils/mapper";
import {
  DEFAULT_REST_ACTION_MAP,
  type RestActionDetail,
} from "../constants/RestActions";

interface RestInternalException {
  message?: string;
  [key: string]: unknown;
}

interface RestInternalData {
  dinBody?: { recordsCount?: number; [key: string]: unknown };
  dinError?: { code?: number | string; message?: string };
  [key: string]: unknown;
}

interface RestInternalContext {
  endpoint?: string;
  method?: string;
  exception?: RestInternalException;
  data?: RestInternalData;
  [key: string]: unknown;
}

interface RestInternalPayload {
  provider?: string;
  TENANT_DOMAIN?: string;
  service?: string;
  operation?: string;
  endpoint?: string;
  action?: string;
  reference?: string;
  id?: string | number;
  exception?: RestInternalException;
  error?: { code?: number | string; message?: string };
  context?: RestInternalContext;
  data?: RestInternalData;
  [key: string]: unknown;
}

export class RestMapper implements LogMapper {
  private readonly actionMap: Record<string, RestActionDetail>;

  constructor(
    actionMap: Record<string, RestActionDetail> = DEFAULT_REST_ACTION_MAP,
  ) {
    this.actionMap = actionMap;
  }

  canHandle(data: NormalizedLogData): boolean {
    const msg = String(data.message ?? "");
    const context = data.context as Record<string, unknown>;
    const isLaravelFile = String(context?.filePath ?? "").includes(
      "laravel.log",
    );
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
    const payload = (details?.payload as Record<string, unknown>) ?? {};

    return (
      String(event.id).toLowerCase() === tId ||
      String(details?.awsRequestId).toLowerCase() === tId ||
      String(
        (event.context as Record<string, unknown>)?.messageId,
      ).toLowerCase() === tId ||
      String(payload?.id ?? "").toLowerCase() === tId ||
      String(payload?.reference ?? "").toLowerCase() === tId ||
      String(payload?.bin ?? "").toLowerCase() === tId
    );
  }

  map(data: NormalizedLogData, _rawLine: string, index: number): LogEvent {
    const msgRaw = data.message ?? "";
    const nrContext = (data.context ?? {}) as Record<string, unknown>;

    const internalData = this.parseInternalJson(msgRaw) as RestInternalPayload;

    const isLaravelLog = msgRaw.includes("production.");

    const provider = String(
      internalData?.provider ??
        internalData?.TENANT_DOMAIN ??
        internalData?.service ??
        (isLaravelLog ? "LARAVEL" : "API_REST"),
    );

    const operation = String(
      internalData?.operation ??
        (isLaravelLog ? "System Log" : "API Operation"),
    );

    const extractedEndpoint = String(
      internalData?.context?.endpoint ??
        internalData?.endpoint ??
        nrContext.filePath ??
        "unknown",
    );

    const extractedMethod = String(
      internalData?.context?.method ?? (isLaravelLog ? "DEBUG" : "POST"),
    );

    let category: LogCategory;
    let displayMessage: string;

    if (isLaravelLog) {
      category = "APPLICATION_LOG";
      displayMessage = this.parseLaravelMessage(msgRaw);
    } else {
      const result = this.buildSdkMessage(internalData, operation);
      category = result.category;
      displayMessage = result.displayMessage;
    }

    const errorResult = this.resolveErrorState(
      internalData,
      nrContext,
      provider,
    );
    if (errorResult) {
      category = errorResult.category;
      displayMessage = errorResult.displayMessage;
    }

    const isError = category === "ERROR";
    const statusCode =
      errorResult?.statusCode ?? (category === "HTTP_RES" ? 200 : null);

    const details: RestDetails = {
      provider,
      operation: internalData?.reference
        ? `REF: ${internalData.reference}`
        : operation,
      action: String(
        internalData?.action ?? (isLaravelLog ? "LOG_EVENT" : "N/A"),
      ),
      method: extractedMethod,
      endpoint: extractedEndpoint,
      statusCode,
      awsRequestId: String(nrContext.messageId ?? internalData?.id ?? ""),
      payload: internalData ?? { raw: msgRaw },
      exception: isError
        ? ((internalData?.context?.exception as
            | Record<string, unknown>
            | undefined) ??
          (nrContext.exception as Record<string, unknown> | undefined) ??
          (internalData?.exception as Record<string, unknown> | undefined))
        : undefined,
      source: "BACKEND",
      isLaravel: isLaravelLog,
    };

    return {
      id: buildEventId(nrContext, index),
      timestamp: data.timestamp,
      level: (isError ? "ERROR" : data.level) as LogLevel,
      message: displayMessage || "Trace event",
      category,
      appType: AppTypes.REST,
      details,
      context: nrContext,
      rawStream: msgRaw.slice(0, RAW_STREAM_MAX_LENGTH),
    };
  }

  // ── Private: Laravel message parsing ──

  private parseLaravelMessage(msgRaw: string): string {
    const parts = msgRaw.split("production.");
    if (!parts[1]) return "";

    const levelAndMsg = parts[1].split(": ");
    const messageWithJson = levelAndMsg[1] ?? "";
    const jsonStart = messageWithJson.indexOf("{");

    return jsonStart !== -1
      ? messageWithJson.substring(0, jsonStart).trim()
      : messageWithJson.trim();
  }

  // ── Private: SDK/API message building ──

  private buildSdkMessage(
    internalData: RestInternalPayload | null,
    operation: string,
  ): { category: LogCategory; displayMessage: string } {
    const action = String(internalData?.action ?? "N/A");
    const category: LogCategory = action.toLowerCase().includes("request")
      ? "HTTP_REQ_OUT"
      : "HTTP_RES";

    const knownAction = this.actionMap[operation];
    let displayMessage = knownAction ? knownAction.message : operation;

    displayMessage += ` | ${action.toUpperCase().replace("-", " ")}`;

    const body =
      internalData?.context?.data?.dinBody ?? internalData?.data?.dinBody;
    if ((body?.recordsCount ?? 0) > 0 && category === "HTTP_RES") {
      displayMessage += ` (${body?.recordsCount} records)`;
    }

    return { category, displayMessage };
  }

  // ── Private: error/status resolution ──

  private resolveErrorState(
    internalData: RestInternalPayload | null,
    nrContext: Record<string, unknown>,
    provider: string,
  ): {
    category: LogCategory;
    displayMessage: string;
    statusCode?: string | number;
  } | null {
    if (!internalData) return null;

    const exception =
      internalData.context?.exception ??
      nrContext.exception ??
      internalData.exception;
    const bizError =
      internalData.context?.data?.dinError ??
      internalData.error ??
      internalData.data?.dinError;

    if (exception) {
      const msg = String((exception as RestInternalException).message ?? "");
      const codeMatch = msg.match(/`(\d{3})`/);
      return {
        category: "ERROR",
        statusCode: codeMatch ? codeMatch[1] : 500,
        displayMessage: `Critical Failure [${provider}]: ${msg.substring(0, 60)}...`,
      };
    }

    if (bizError?.code && bizError.code !== "0000") {
      return {
        category: "ERROR",
        statusCode: bizError.code,
        displayMessage: `${provider} | Error ${bizError.code}: ${bizError.message ?? "Failed Op."}`,
      };
    }

    return null;
  }

  // ── Private: JSON repair ──

  private parseInternalJson(message: string): unknown {
    if (typeof message !== "string") return null;
    const jsonStart = message.indexOf("{");
    if (jsonStart === -1) return null;

    let rawJson = message.substring(jsonStart).trim();

    if (rawJson.includes("(truncated...)")) {
      rawJson = rawJson.split("(truncated...)")[0].trim();
    }

    if (rawJson.includes("} {")) {
      rawJson = `${rawJson.split("} {")[0]}}`;
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
