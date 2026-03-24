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
import type { LogMapper } from "../../common/mappers/BaseMapper";
import {
  type CheckoutActionDetail,
  DEFAULT_CHECKOUT_ACTION_MAP,
} from "../constants/CheckoutActions";

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
    const msg = String(data.message || "");

    return !!(
      ctx.session_id ||
      ctxData.session_id ||
      (typeof ctx.TENANT_DOMAIN === "string" &&
        (ctx.TENANT_DOMAIN.includes("checkout") ||
          ctx.TENANT_DOMAIN.includes("redirection"))) ||
      msg.includes("Request trace") ||
      msg.includes("placetopay_event") ||
      msg.includes("[GW_LIB]")
    );
  }

  isMatch(event: LogEvent, targetId: string): boolean {
    const details = event.details as CheckoutDetails;
    const ctx = (event.context || {}) as Record<string, unknown>;
    const payload = (ctx.payload || {}) as Record<string, unknown>;
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
    const ctx = (data.context ?? {}) as Record<string, unknown>;
    const subType = ctx.type ? String(ctx.type) : null;
    const action = ctx.action_method ? String(ctx.action_method).trim() : null;
    const msgRaw = data.message ?? "";

    const actionKey = subType === "checkout.session.created" ? subType : action;
    const knownAction = actionKey ? this.actionMap[actionKey] : null;

    let displayMessage = msgRaw;
    let category: LogCategory = "BACKEND_LOG";
    let source = "BACKEND";
    let visualLevel: LogLevel | null = null;
    let provider: string | null = null;

    const isGatewayLog = msgRaw.includes("[GW_LIB]");
    const isCoreApiLog = msgRaw === "HTTP Req" || msgRaw === "HTTP Res";

    const request = (ctx.request ?? {}) as Record<string, unknown>;
    const response = (ctx.response ?? {}) as Record<string, unknown>;
    const requestBody = (request.body ?? {}) as Record<string, unknown>;
    const responseBody = (response.body ?? {}) as Record<string, unknown>;
    const paymentBody = (requestBody.payment ?? {}) as Record<string, unknown>;

    const requestUrl = String(request.url || response.url || "");

    if (isGatewayLog) {
      provider = String(
        responseBody.provider || paymentBody.provider || "GATEWAY",
      );
      category = msgRaw.includes("Req") ? "HTTP_REQ_OUT" : "HTTP_RES";

      const rStatus = responseBody.status as
        | Record<string, unknown>
        | undefined;
      const statusSuffix = rStatus?.status ? ` [${rStatus.status}]` : "";
      const reasonSuffix =
        rStatus?.reason && rStatus.status !== "OK"
          ? ` (${rStatus.reason})`
          : "";

      if (requestUrl.includes("/otp/generate"))
        displayMessage = `Gateway: OTP Generation${statusSuffix}`;
      else if (requestUrl.includes("/otp/validate"))
        displayMessage = `Gateway: OTP Validation${statusSuffix}${reasonSuffix}`;
      else if (requestUrl.includes("/mpi/lookup"))
        displayMessage = `Gateway: 3DS Lookup (MPI)${statusSuffix}`;
      else if (requestUrl.includes("/process"))
        displayMessage = `Gateway: Process Payment${statusSuffix}${reasonSuffix}`;
      else if (requestUrl.includes("/collect"))
        displayMessage = `Gateway: Collect${statusSuffix}${reasonSuffix}`;
      else if (requestUrl.includes("/information"))
        displayMessage = `Gateway: Instrument Information${statusSuffix}`;
      else
        displayMessage = `Gateway: ${msgRaw.includes("Req") ? "Outgoing Request" : "Response"}`;
    } else if (isCoreApiLog && requestUrl.includes("/core/tokenize")) {
      provider = "CORE_API";
      category = msgRaw.includes("Req") ? "HTTP_REQ_OUT" : "HTTP_RES";
      displayMessage = msgRaw.includes("Req")
        ? "Core: Request Tokenization"
        : "Core: Token Generated";
    } else if (
      msgRaw.includes("Update session state trace") ||
      msgRaw.includes("Define session trace")
    ) {
      category = "DB_OP";
      displayMessage = "State Update (Session)";
    } else if (msgRaw.includes("Update transaction trace")) {
      category = "DB_OP";
      displayMessage = "State Update (Transaction)";
    } else if (msgRaw.includes("Opening 3DS lightbox")) {
      category = "USER_ACTION";
      displayMessage = "Deploy 3DS Lightbox";
    } else if (knownAction) {
      displayMessage = knownAction.message;
      category = knownAction.category;
      source =
        typeof knownAction.source === "string" ? knownAction.source : "BACKEND";

      const gateway = ctx.body
        ? (ctx.body as Record<string, unknown>).gateway
        : ctx.gateway;
      if (gateway) {
        displayMessage += ` via ${String(gateway).toUpperCase()}`;
      }
    } else if (msgRaw === "placetopay_event" && subType) {
      displayMessage = `Event: ${subType}`;
    } else {
      category = this.inferCheckoutCategory(msgRaw, subType);
      source = this.determineSource(data, ctx);
    }

    const exception = (ctx.exception ?? null) as Record<string, unknown> | null;
    const isValidationErr =
      subType === "request_not_valid" ||
      exception?.reason === "request_not_valid" ||
      msgRaw.toLowerCase().includes("error validation");

    if (exception && !isValidationErr) {
      category = "ERROR";
      visualLevel = "ERROR";
      displayMessage = `Exception: ${String(exception.message || "").substring(0, 80)}...`;
    } else if (isValidationErr || data.level === "500") {
      category = "ERROR";
      visualLevel = "ERROR";
      displayMessage = msgRaw.toLowerCase().includes("otp")
        ? "OTP Validation Error"
        : "Validation Error (Request)";

      const gatewayName = ctx.gateway
        ? ` [${String(ctx.gateway).toUpperCase()}]`
        : "";
      displayMessage += gatewayName;
    }

    const httpInfo = extractHttpFromMessage(msgRaw);
    const rawUrlForEndpoint =
      requestUrl ||
      (ctx.notification_url ? String(ctx.notification_url) : "") ||
      httpInfo.path ||
      "";

    let endpoint: string | null = null;
    if (isGatewayLog || isCoreApiLog) {
      try {
        endpoint = rawUrlForEndpoint
          ? new URL(rawUrlForEndpoint).pathname
          : null;
      } catch {
        endpoint = normalizePath(rawUrlForEndpoint);
      }
    } else {
      endpoint = rawUrlForEndpoint
        ? normalizePath(rawUrlForEndpoint)
        : isValidationErr
          ? "Validation Layer"
          : null;
    }

    const method = String(
      request.method ||
        httpInfo.method ||
        this.resolveMethod(request, action, subType),
    );

    const ctxData = (ctx.data ?? {}) as Record<string, unknown>;

    const details: CheckoutDetails = {
      method,
      endpoint,
      url: endpoint || undefined,
      statusCode: (response.status_code ??
        ctx.status_code ??
        (category === "ERROR" ? 500 : 200)) as number | string | null,
      sessionId: (ctx.session_id ?? ctxData.session_id ?? "") as
        | string
        | number,
      transactionId: (ctx.transaction_id ?? ctx.placetopay_id ?? "") as
        | string
        | number,
      awsRequestId: (ctx.aws_request_id ??
        (ctx.payload as Record<string, unknown>)?.aws_request_id ??
        null) as string | null,
      subType,
      source,
      provider,
      payload: ctx.payload || ctx.data || ctx,
      title:
        msgRaw &&
        msgRaw.trim() !== "HTTP Req" &&
        msgRaw.trim() !== "HTTP Res" &&
        !msgRaw.includes("[GW_LIB]")
          ? msgRaw
          : undefined,
    };

    return {
      id: buildEventId(ctx, index),
      timestamp: data.timestamp,
      level: (visualLevel || data.level || "INFO") as LogLevel,
      message: displayMessage,
      category,
      appType: AppTypes.CHECKOUT,
      details,
      context: ctx,
      rawStream: msgRaw.slice(0, 200),
    };
  }

  private determineSource(
    data: NormalizedLogData,
    ctx: Record<string, unknown>,
  ): string {
    if (data.message.includes("CLICK_TO_PAY-SDK")) return "BACKEND";
    const channel =
      (data as unknown as Record<string, unknown>).channel ?? ctx.channel;
    if (channel === "frontend") return "FRONTEND";
    return "BACKEND";
  }

  private resolveMethod(
    request: Record<string, unknown>,
    action: string | null,
    subType: string | null,
  ): string {
    if (request.method) return String(request.method);
    if (subType === "checkout.session.created" || action === "createSession")
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
    if (m.includes("request trace") || s === "checkout.session.created")
      return "HTTP_REQ_IN";
    if (m.includes("response")) return "HTTP_RES";
    if (m.includes("update") || m.includes("save") || m.includes("db"))
      return "DB_OP";
    return "BACKEND_LOG";
  }
}
