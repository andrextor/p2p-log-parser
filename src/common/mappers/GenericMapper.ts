import {
  type AppType,
  AppTypes,
  type LogEvent,
  type LogLevel,
  type NormalizedLogData,
  type RestDetails,
} from "@/types";
import { buildEventId, extractTimestamp } from "@/utils/mapper";
import { RAW_STREAM_MAX_LENGTH } from "../constants";
import type { LogMapper } from "./BaseMapper";

export class GenericMapper implements LogMapper {
  private readonly appType: AppType;

  constructor(appType: AppType = AppTypes.REST) {
    this.appType = appType;
  }

  canHandle(_data: NormalizedLogData): boolean {
    return true;
  }

  isMatch(event: LogEvent, targetId: string): boolean {
    const details = event.details as RestDetails;
    const tId = String(targetId).toLowerCase();

    return (
      String(event.id).toLowerCase() === tId ||
      String(details?.awsRequestId).toLowerCase() === tId
    );
  }

  map(data: NormalizedLogData, rawLine: string, index: number): LogEvent {
    const ctx = (data.context ?? {}) as Record<string, unknown>;
    const message = String(data.message ?? "Generic Log");

    const request = (ctx.request ?? {}) as Record<string, unknown>;
    const response = (ctx.response ?? {}) as Record<string, unknown>;

    return {
      id: buildEventId(ctx, index),
      timestamp: extractTimestamp(
        data as unknown as Record<string, unknown>,
        rawLine,
      ),
      level: (data.level as LogLevel) ?? "INFO",
      message,
      category: this.inferBasicCategory(message),
      appType: this.appType,
      details: {
        method: String(request.method ?? ""),
        endpoint: String(request.url ?? ""),
        statusCode: (response.status_code ?? null) as number | null,
        provider: String(ctx.provider ?? ""),
        action: String(ctx.action ?? ""),
        operation: String(ctx.operation ?? ""),
        awsRequestId: String(ctx.aws_request_id ?? ""),
        source: "BACKEND",
      } as RestDetails,
      context: data.context,
      rawStream: rawLine.slice(0, RAW_STREAM_MAX_LENGTH),
    };
  }

  private inferBasicCategory(msg: string): LogEvent["category"] {
    const m = msg.toLowerCase();
    if (m.includes("http")) return "HTTP_REQ_OUT";
    if (m.includes("db") || m.includes("sql")) return "DB_OP";
    return "GENERIC";
  }
}
