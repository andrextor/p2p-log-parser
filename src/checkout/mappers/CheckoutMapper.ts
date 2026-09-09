import { resolveOutcome } from "@/common/outcome";
import {
  AppTypes,
  type CheckoutDetails,
  type LogCategory,
  type LogEvent,
  type LogLevel,
  type NormalizedLogData,
  type Outcome,
} from "@/types";
import {
  buildEventBase,
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
import { readTracePhase } from "../constants/CheckoutTracePhases";

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
      msg.includes(MARKER.PLACETOPAY_LOG) ||
      msg.includes(MARKER.GATEWAY)
    );
  }

  map(data: NormalizedLogData, _rawLine: string, _index: number): LogEvent {
    const ext = this.extractContext(data);
    const traceParts = readTracePhase(ext.msgRaw);

    const isGatewayLog = ext.msgRaw.includes(MARKER.GATEWAY);
    const isCoreApiLog = ext.msgRaw === "HTTP Req" || ext.msgRaw === "HTTP Res";

    const built = this.buildMessage(ext, isGatewayLog, isCoreApiLog);

    const outcome = resolveOutcome({
      context: ext.ctx,
      payload: ext.ctx,
      message: ext.msgRaw,
      subType: ext.subType,
    });

    const errorResult = this.handleErrors(ext.ctx, ext.msgRaw, outcome, built);

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
      // Sin código en el log se deja `null`: un 200 inventado se lee como
      // «respondió correctamente», que es justo lo que no sabemos.
      statusCode: (ext.response.status_code ?? ext.ctx.status_code ?? null) as
        | number
        | string
        | null,
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
      phase: traceParts?.phase,
      step: traceParts?.step,
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
      ...buildEventBase(ext.ctx, data.timestamp, displayMessage, data.extra),
      timestamp: data.timestamp,
      level: (visualLevel ?? data.level ?? "INFO") as LogLevel,
      message: displayMessage,
      category,
      appType: AppTypes.CHECKOUT,
      details,
      context: ext.ctx,
      outcome,
      ...this.buildPairing(ext, isGatewayLog, isCoreApiLog),
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

    if (
      (ext.msgRaw === MARKER.PLACETOPAY_EVENT ||
        ext.msgRaw === MARKER.PLACETOPAY_LOG) &&
      ext.subType
    ) {
      return {
        displayMessage: `Event: ${ext.subType}`,
        category: "BACKEND_LOG",
        source: "BACKEND",
        provider: null,
      };
    }

    // El prefijo `«{sujeto} trace:»` da la categoría de forma determinista;
    // sin él hay que adivinarla por palabras del mensaje.
    const trace = readTracePhase(ext.msgRaw);
    if (trace) {
      return {
        displayMessage: ext.msgRaw,
        category: trace.category,
        source: this.determineSource(ext.ctx, ext.msgRaw),
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

  /**
   * Empareja la ida y la vuelta de una llamada saliente.
   *
   * `guzzle-logger` emite la petición y la respuesta como registros separados
   * que comparten `aws_request_id`; la ruta los distingue cuando hay varias
   * llamadas seguidas en la misma invocación.
   *
   * El rol sale de la **forma del contexto**, no del texto del mensaje: cada
   * integración lo redacta a su manera —Apple Pay, Google Pay, Click to Pay…—,
   * así que exigir `HTTP Req` dejaba sin emparejar todo lo que no fuera el
   * gateway propio. Un registro de Guzzle trae `request` o `response`, nunca
   * los dos, y eso sí es estable.
   */
  private buildPairing(
    ext: ExtractedContext,
    isGatewayLog: boolean,
    isCoreApiLog: boolean,
  ): { pairKey?: string; pairRole?: LogEvent["pairRole"] } {
    const traceId = ext.ctx.aws_request_id;
    if (!traceId) return {};

    const hasRequest = ext.request.url !== undefined;
    const hasResponse = ext.response.url !== undefined;

    let isRequest: boolean;
    if (ext.msgRaw.includes("HTTP Req")) isRequest = true;
    else if (ext.msgRaw.includes("HTTP Res")) isRequest = false;
    else if (hasResponse) isRequest = false;
    else if (hasRequest) isRequest = true;
    else return {};

    // Sin URL no hay forma de separar dos llamadas seguidas bajo la misma
    // traza, así que solo se empareja lo que el mensaje ya identificaba.
    if (!hasRequest && !hasResponse && !isGatewayLog && !isCoreApiLog)
      return {};

    const path = ext.requestUrl ? normalizePath(ext.requestUrl) : "";

    return {
      pairKey: `${String(traceId)}|${path}`,
      pairRole: isRequest ? "request" : "response",
    };
  }

  // ── Private: error handling ──

  private handleErrors(
    ctx: Record<string, unknown>,
    msgRaw: string,
    outcome: Outcome,
    built: BuildMessageResult,
  ): {
    displayMessage?: string;
    category?: LogCategory;
    visualLevel?: LogLevel;
  } {
    if (!outcome.isError) return { category: built.category };

    if (outcome.kind === "validation") {
      const base = msgRaw.toLowerCase().includes("otp")
        ? "OTP Validation Error"
        : "Validation Error (Request)";
      const gateway = ctx.gateway
        ? ` [${String(ctx.gateway).toUpperCase()}]`
        : "";

      return {
        displayMessage: `${base}${gateway}`,
        category: "ERROR",
        visualLevel: "ERROR",
      };
    }

    if (outcome.kind === "exception") {
      return {
        displayMessage: `Exception: ${(outcome.message ?? "").substring(0, 80)}...`,
        category: "ERROR",
        visualLevel: "ERROR",
      };
    }

    // Un rechazo del gateway (`status.status !== "OK"`) queda registrado en
    // `outcome`, pero Checkout ya lo representa en el mensaje —«Gateway: OTP
    // Validation [FAILED] (…)»— y su categoría sigue siendo la del transporte.
    // Alinear eso es alcance de la fase de Checkout.
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
