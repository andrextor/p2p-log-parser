import {
  AppTypes,
  type CheckoutDetails,
  type LogCategory,
  type LogEvent,
  type LogLevel,
  type NormalizedLogData,
} from "@/types";
import {
  buildEventId,
  extractHttpFromMessage,
  normalizePath,
} from "@/utils/mapper";
import {
  GATEWAY_PATH_LABELS,
  MARKER,
  RAW_STREAM_MAX_LENGTH,
} from "../../common/constants";
import type { LogMapper } from "../../common/mappers/BaseMapper";
import {
  type CheckoutActionDetail,
  DEFAULT_CHECKOUT_ACTION_MAP,
} from "../constants/CheckoutActions";

interface ExtractedContext {
  ctx: Record<string, unknown>;
  subType: string | null;
  action: string | null;
  msgRaw: string;
  actionKey: string | null;
  knownAction: CheckoutActionDetail | null;
  path: string;
  httpInfo: { method?: string; path?: string };
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  requestBody: Record<string, unknown>;
  responseBody: Record<string, unknown>;
  paymentBody: Record<string, unknown>;
  requestUrl: string;
}

interface BuildMessageResult {
  displayMessage: string;
  category: LogCategory;
  source: string;
  provider: string | null;
}

export class CheckoutMapper implements LogMapper {
  private readonly actionMap: Record<string, CheckoutActionDetail>;

  constructor(
    actionMap: Record<
      string,
      CheckoutActionDetail
    > = DEFAULT_CHECKOUT_ACTION_MAP,
  ) {
    this.actionMap = actionMap;
  }

  canHandle(data: NormalizedLogData): boolean {
    if (!data) return false;
    const ctx = (data.context ?? {}) as Record<string, unknown>;
    const ctxData = (ctx.data ?? {}) as Record<string, unknown>;
    const msg = String(data.message ?? "");

    return !!(
      ctx.session_id ||
      ctxData.session_id ||
      (typeof ctx.TENANT_DOMAIN === "string" &&
        (ctx.TENANT_DOMAIN.includes("checkout") ||
          ctx.TENANT_DOMAIN.includes("redirection"))) ||
      msg.includes(MARKER.REQUEST_TRACE) ||
      msg.includes(MARKER.PLACETOPAY_EVENT) ||
      msg.includes(MARKER.GATEWAY)
    );
  }

  isMatch(event: LogEvent, targetId: string): boolean {
    const details = event.details as CheckoutDetails;
    const ctx = (event.context ?? {}) as Record<string, unknown>;
    const payload = (ctx.payload ?? {}) as Record<string, unknown>;
    const tId = String(targetId).toLowerCase();

    return (
      String(event.id).toLowerCase() === tId ||
      String(details?.sessionId).toLowerCase() === tId ||
      String(details?.transactionId).toLowerCase() === tId ||
      String(details?.awsRequestId).toLowerCase() === tId ||
      String(ctx?.aws_request_id).toLowerCase() === tId ||
      String(payload?.session_id).toLowerCase() === tId
    );
  }

  map(data: NormalizedLogData, _rawLine: string, index: number): LogEvent {
    const ext = this.extractContext(data);

    const isGatewayLog = ext.msgRaw.includes(MARKER.GATEWAY);
    const isCoreApiLog = ext.msgRaw === "HTTP Req" || ext.msgRaw === "HTTP Res";

    const built = this.buildMessage(ext, isGatewayLog, isCoreApiLog);

    const errorResult = this.handleErrors(
      data.level,
      ext.ctx,
      ext.msgRaw,
      ext.subType,
      built,
    );

    const displayMessage = errorResult.displayMessage ?? built.displayMessage;
    const category = errorResult.category ?? built.category;
    const visualLevel = errorResult.visualLevel ?? null;

    const endpoint = this.buildEndpoint(
      ext.requestUrl,
      ext.path,
      ext.ctx,
      isGatewayLog,
      isCoreApiLog,
    );

    const method = String(
      ext.request.method ??
        ext.httpInfo.method ??
        this.resolveMethod(ext.request, ext.action, ext.subType),
    );

    const ctxData = (ext.ctx.data ?? {}) as Record<string, unknown>;

    const details: CheckoutDetails = {
      method,
      endpoint,
      url: endpoint || undefined,
      statusCode: (ext.response.status_code ??
        ext.ctx.status_code ??
        (category === "ERROR" ? 500 : 200)) as number | string | null,
      sessionId: (ext.ctx.session_id ?? ctxData.session_id ?? "") as
        | string
        | number,
      transactionId: (ext.ctx.transaction_id ?? ext.ctx.placetopay_id ?? "") as
        | string
        | number,
      awsRequestId: (ext.ctx.aws_request_id ??
        (ext.ctx.payload as Record<string, unknown>)?.aws_request_id ??
        null) as string | null,
      subType: ext.subType,
      source: built.source,
      provider: built.provider,
      payload: ext.ctx.payload ?? ext.ctx.data ?? ext.ctx,
      title:
        ext.msgRaw &&
        ext.msgRaw.trim() !== "HTTP Req" &&
        ext.msgRaw.trim() !== "HTTP Res" &&
        !ext.msgRaw.includes(MARKER.GATEWAY)
          ? ext.msgRaw
          : undefined,
      rawTitle: ext.msgRaw || undefined,
    };

    return {
      id: buildEventId(ext.ctx, index),
      timestamp: data.timestamp,
      level: (visualLevel ?? data.level ?? "INFO") as LogLevel,
      message: displayMessage,
      category,
      appType: AppTypes.CHECKOUT,
      details,
      context: ext.ctx,
      rawStream: ext.msgRaw.slice(0, RAW_STREAM_MAX_LENGTH),
    };
  }

  // ── Private: context extraction ──

  private extractContext(data: NormalizedLogData): ExtractedContext {
    const ctx = (data.context ?? {}) as Record<string, unknown>;
    const subType = ctx.type ? String(ctx.type) : null;
    const action = ctx.action_method ? String(ctx.action_method).trim() : null;
    const msgRaw = data.message ?? "";

    const actionKey = subType === MARKER.SESSION_CREATED ? subType : action;
    const knownAction = actionKey ? this.actionMap[actionKey] : null;

    const httpInfo = extractHttpFromMessage(msgRaw);
    const path = httpInfo.path ?? "";

    const request = (ctx.request ?? {}) as Record<string, unknown>;
    const response = (ctx.response ?? {}) as Record<string, unknown>;
    const requestBody = (request.body ?? {}) as Record<string, unknown>;
    const responseBody = (response.body ?? {}) as Record<string, unknown>;
    const paymentBody = (requestBody.payment ?? {}) as Record<string, unknown>;

    const requestUrl = String(request.url ?? response.url ?? "");

    return {
      ctx,
      subType,
      action,
      msgRaw,
      actionKey,
      knownAction,
      path,
      httpInfo,
      request,
      response,
      requestBody,
      responseBody,
      paymentBody,
      requestUrl,
    };
  }

  // ── Private: message building ──

  private buildMessage(
    ext: ExtractedContext,
    isGatewayLog: boolean,
    isCoreApiLog: boolean,
  ): BuildMessageResult {
    if (isGatewayLog) {
      return this.buildGatewayMessage(ext);
    }

    if (isCoreApiLog && ext.requestUrl.includes("/core/tokenize")) {
      return {
        displayMessage: ext.msgRaw.includes("Req")
          ? "Core: Request Tokenization"
          : "Core: Token Generated",
        category: ext.msgRaw.includes("Req") ? "HTTP_REQ_OUT" : "HTTP_RES",
        source: "BACKEND",
        provider: "CORE_API",
      };
    }

    if (
      ext.msgRaw.includes("Update session state trace") ||
      ext.msgRaw.includes("Define session trace")
    ) {
      return {
        displayMessage: "State Update (Session)",
        category: "DB_OP",
        source: "BACKEND",
        provider: null,
      };
    }

    if (ext.msgRaw.includes("Update transaction trace")) {
      return {
        displayMessage: "State Update (Transaction)",
        category: "DB_OP",
        source: "BACKEND",
        provider: null,
      };
    }

    if (ext.msgRaw.includes("Opening 3DS lightbox")) {
      const isLightbox = ext.ctx.openInLightbox;
      const displayMethod = isLightbox === false ? "Redirection" : "Lightbox";
      return {
        displayMessage: `Opening 3DS (${displayMethod})`,
        category: "USER_ACTION",
        source: "BACKEND",
        provider: null,
      };
    }

    if (ext.knownAction) {
      return this.buildKnownActionMessage(ext);
    }

    if (ext.msgRaw === MARKER.PLACETOPAY_EVENT && ext.subType) {
      return {
        displayMessage: `Event: ${ext.subType}`,
        category: "BACKEND_LOG",
        source: "BACKEND",
        provider: null,
      };
    }

    return {
      displayMessage: ext.msgRaw,
      category: this.inferCheckoutCategory(ext.msgRaw, ext.subType),
      source: this.determineSource(ext.ctx, ext.msgRaw),
      provider: null,
    };
  }

  private buildGatewayMessage(ext: ExtractedContext): BuildMessageResult {
    const provider = String(
      ext.responseBody.provider ?? ext.paymentBody.provider ?? "GATEWAY",
    );
    const category: LogCategory = ext.msgRaw.includes("Req")
      ? "HTTP_REQ_OUT"
      : "HTTP_RES";

    const rStatus = ext.responseBody.status as
      | Record<string, unknown>
      | undefined;
    const statusSuffix = rStatus?.status ? ` [${rStatus.status}]` : "";
    const reasonSuffix =
      rStatus?.reason && rStatus.status !== "OK" ? ` (${rStatus.reason})` : "";

    const matchedEntry = Object.entries(GATEWAY_PATH_LABELS).find(
      ([fragment]) => ext.requestUrl.includes(fragment),
    );

    let displayMessage: string;
    if (matchedEntry) {
      const [, config] = matchedEntry;
      displayMessage = config.showReason
        ? `${config.label}${statusSuffix}${reasonSuffix}`
        : `${config.label}${statusSuffix}`;
    } else {
      displayMessage = `Gateway: ${ext.msgRaw.includes("Req") ? "Outgoing Request" : "Response"}`;
    }

    return { displayMessage, category, source: "BACKEND", provider };
  }

  private buildKnownActionMessage(ext: ExtractedContext): BuildMessageResult {
    const knownAction = ext.knownAction as CheckoutActionDetail;
    let displayMessage = knownAction.message;
    let category: LogCategory = knownAction.category;
    const source =
      typeof knownAction.source === "string" ? knownAction.source : "BACKEND";

    if (ext.actionKey === "requestOtp" && ext.msgRaw.includes("wallet")) {
      displayMessage = "Wallet P2P OTP Generation Request";
    } else if (ext.actionKey === "checkOtp" && ext.msgRaw.includes("wallet")) {
      displayMessage = "Wallet P2P OTP Validation by user";
    } else if (ext.actionKey === "index") {
      if (ext.path.includes("/user")) {
        displayMessage = "Frontend: User data validation";
        category = "USER_ACTION";
      } else if (ext.path.includes("/information")) {
        displayMessage = "Frontend: Requesting payment method information";
        category = "USER_ACTION";
      }
    }

    const gateway = ext.ctx.body
      ? (ext.ctx.body as Record<string, unknown>).gateway
      : ext.ctx.gateway;
    if (gateway) {
      displayMessage += ` via ${String(gateway).toUpperCase()}`;
    }

    return { displayMessage, category, source, provider: null };
  }

  // ── Private: error handling ──

  private handleErrors(
    level: string,
    ctx: Record<string, unknown>,
    msgRaw: string,
    subType: string | null,
    built: BuildMessageResult,
  ): {
    displayMessage?: string;
    category?: LogCategory;
    visualLevel?: LogLevel;
  } {
    const exception = (ctx.exception ?? null) as Record<string, unknown> | null;
    const isValidationErr =
      subType === "request_not_valid" ||
      exception?.reason === "request_not_valid" ||
      msgRaw.toLowerCase().includes("error validation");

    if (exception && !isValidationErr) {
      return {
        displayMessage: `Exception: ${String(exception.message ?? "").substring(0, 80)}...`,
        category: "ERROR",
        visualLevel: "ERROR",
      };
    }

    if (isValidationErr || level === "500") {
      let displayMessage = msgRaw.toLowerCase().includes("otp")
        ? "OTP Validation Error"
        : "Validation Error (Request)";

      const gatewayName = ctx.gateway
        ? ` [${String(ctx.gateway).toUpperCase()}]`
        : "";
      displayMessage += gatewayName;

      return { displayMessage, category: "ERROR", visualLevel: "ERROR" };
    }

    return { category: built.category };
  }

  // ── Private: endpoint ──

  private buildEndpoint(
    requestUrl: string,
    path: string,
    ctx: Record<string, unknown>,
    isGatewayLog: boolean,
    isCoreApiLog: boolean,
  ): string | null {
    const rawUrlForEndpoint =
      requestUrl ||
      (ctx.notification_url ? String(ctx.notification_url) : "") ||
      path ||
      "";

    if (!rawUrlForEndpoint) return null;

    if (isGatewayLog || isCoreApiLog) {
      try {
        return new URL(rawUrlForEndpoint).pathname;
      } catch {
        return normalizePath(rawUrlForEndpoint);
      }
    }

    return normalizePath(rawUrlForEndpoint);
  }

  // ── Private: helpers ──

  private determineSource(
    ctx: Record<string, unknown>,
    message: string,
  ): string {
    if (message.includes("CLICK_TO_PAY-SDK")) return "BACKEND";

    if (
      message.includes(MARKER.REQUEST_TRACE) ||
      (message.includes(MARKER.PLACETOPAY_EVENT) &&
        ctx.type === MARKER.SESSION_ENTRY)
    ) {
      return "FRONTEND";
    }

    if (ctx.channel === "frontend") return "FRONTEND";
    return "BACKEND";
  }

  private resolveMethod(
    request: Record<string, unknown>,
    action: string | null,
    subType: string | null,
  ): string {
    if (request.method) return String(request.method);
    if (subType === MARKER.SESSION_CREATED || action === "createSession")
      return "POST";
    if (action === "show" || action === "index") return "GET";
    if (action?.includes("Controller")) return "POST";
    return "POST";
  }

  private inferCheckoutCategory(
    msg: string,
    subType: string | null,
  ): LogCategory {
    const m = msg.toLowerCase();
    const s = (subType ?? "").toLowerCase();

    if (s.includes("notification") || m.includes("notify"))
      return "NOTIFICATION";
    if (m.includes("http req")) return "HTTP_REQ_OUT";
    if (
      m.includes(MARKER.REQUEST_TRACE.toLowerCase()) ||
      s === MARKER.SESSION_CREATED
    )
      return "HTTP_REQ_IN";
    if (m.includes("response")) return "HTTP_RES";
    if (m.includes("update") || m.includes("save") || m.includes("db"))
      return "DB_OP";
    return "BACKEND_LOG";
  }
}
