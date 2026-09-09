import type {
  DomainMetadata,
  MetadataExtractor,
} from "@/common/metadata/MetadataExtractor";
import { AppTypes, type CheckoutDetails, type LogEvent } from "@/types";

/**
 * Los hitos del flujo de checkout, en el orden en que ocurren. Sustituye al
 * antiguo `flags {otp, threeDS, interest}`, que era este mismo objeto recortado
 * a tres campos: los consumidores acababan recalculando los otros cinco a mano
 * con `endpoint.includes(...)`, que es justo lo que el parser existe para
 * evitar.
 */
export interface CheckoutFunnelSteps {
  created: boolean;
  entry: boolean;
  show: boolean;
  information: boolean;
  interest: boolean;
  otp: boolean;
  threeDS: boolean;
  process: boolean;
}

export interface CheckoutSessionMetadata {
  sessionId: string;
  sessionType: "PAYMENT" | "COLLECT" | "SUBSCRIPTION" | "AUTOPAY" | "UNKNOWN";
  finalState: string;
  hasSuccessfulTransaction: boolean;
  reference?: string;
  steps: CheckoutFunnelSteps;
  /** Epoch ms del primer evento de cada hito. Ausente si el hito no ocurrió. */
  timings: {
    created?: number;
    entry?: number;
    show?: number;
  };
  /** Derivadas de `timings`, en ms. Ausentes si falta alguno de los extremos. */
  durations: {
    timeToEntry?: number;
    timeToShow?: number;
  };
}

export interface CheckoutParseMetadata extends DomainMetadata {
  totalSessions: number;
  sessions: CheckoutSessionMetadata[];
}

export class CheckoutMetadataExtractor
  implements MetadataExtractor<CheckoutParseMetadata>
{
  readonly appType = AppTypes.CHECKOUT;

  extract(events: LogEvent[]): CheckoutParseMetadata | undefined {
    const sessionMap = new Map<string, CheckoutSessionMetadata>();

    for (const event of events) {
      if (event.appType !== AppTypes.CHECKOUT) continue;

      const details = event.details as CheckoutDetails;
      const sessionId = details?.sessionId;
      if (!sessionId) continue;

      const sid = String(sessionId);

      if (!sessionMap.has(sid)) {
        sessionMap.set(sid, this.createEmptySession(sid));
      }

      const row = sessionMap.get(sid);
      if (!row) continue;

      try {
        const endpoint = String(details.endpoint ?? "").toLowerCase();
        const ctx = event.context as Record<string, unknown>;
        const payload = (details.payload ?? {}) as Record<string, unknown>;
        const action = String(
          ctx?.action_method ?? payload?.action_method ?? "",
        ).toLowerCase();
        const subType = String(details.subType ?? "").toLowerCase();
        const msg = String(event.message ?? "").toLowerCase();
        const title = String(details.title ?? "").toLowerCase();

        this.detectFunnelSteps(row, action, subType, endpoint, msg, event.ts);
        this.detectFinalState(row, msg, title, payload);
        this.detectTransactionStatus(row, msg, title, payload);
        this.detectSessionType(row, payload);
      } catch {
        // Skip events with malformed payload shapes
      }
    }

    this.applyFunnelTypeDefaults(sessionMap);

    // Antes hacían falta dos sesiones para devolver metadata, justo lo
    // contrario del caso más común: depurar un pago concreto.
    if (sessionMap.size === 0) return undefined;

    return {
      totalEvents: events.length,
      totalSessions: sessionMap.size,
      sessions: Array.from(sessionMap.values()),
    };
  }

  // ── Private: session initialization ──

  private createEmptySession(sid: string): CheckoutSessionMetadata {
    return {
      sessionId: sid,
      sessionType: "UNKNOWN",
      finalState: "UNDEFINED",
      hasSuccessfulTransaction: false,
      steps: {
        created: false,
        entry: false,
        show: false,
        information: false,
        interest: false,
        otp: false,
        threeDS: false,
        process: false,
      },
      timings: {},
      durations: {},
    };
  }

  // ── Private: funnel step detection ──

  private detectFunnelSteps(
    row: CheckoutSessionMetadata,
    action: string,
    subType: string,
    endpoint: string,
    msg: string,
    ts?: number,
  ): void {
    const { steps } = row;

    // Solo los tres hitos que abren el flujo se fechan: son los extremos de las
    // duraciones que interesan. El resto se responde con un sí/no.
    const mark = (key: "created" | "entry" | "show") => {
      steps[key] = true;
      if (ts !== undefined && row.timings[key] === undefined) {
        row.timings[key] = ts;
      }
    };

    if (subType === "checkout.session.created" || action === "createsession") {
      mark("created");
    }
    if (action === "entry" || subType === "checkout.session.entry") {
      mark("entry");
    }
    if (action === "show") {
      mark("show");
    }
    if (endpoint.includes("/information")) {
      steps.information = true;
    }
    if (endpoint.includes("/interest")) {
      steps.interest = true;
    }
    if (
      endpoint.includes("/otp/generate") ||
      endpoint.includes("/otp/validate") ||
      endpoint.includes("/wallet/otp") ||
      action === "checkotp" ||
      action === "walletotpgenerate" ||
      action === "walletotpvalidate"
    ) {
      steps.otp = true;
    }
    if (endpoint.includes("/mpi/lookup") || msg.includes("3ds")) {
      steps.threeDS = true;
    }
    if (
      action === "process" ||
      endpoint.includes("/process") ||
      endpoint.includes("/collect")
    ) {
      steps.process = true;
    }
  }

  // ── Private: final state detection ──

  private detectFinalState(
    row: CheckoutSessionMetadata,
    msg: string,
    title: string,
    payload: Record<string, unknown>,
  ): void {
    if (
      msg.includes("state update (session)") ||
      title.includes("session state trace") ||
      title.includes("define session trace")
    ) {
      const state =
        payload.new_state ?? payload.state_to_update ?? payload.session_state;
      if (state) {
        row.finalState = String(state).toUpperCase();
      }
    }
  }

  // ── Private: transaction status ──

  private detectTransactionStatus(
    row: CheckoutSessionMetadata,
    msg: string,
    title: string,
    payload: Record<string, unknown>,
  ): void {
    if (
      msg.includes("state update (transaction)") ||
      title.includes("update transaction trace")
    ) {
      const state = payload.state ?? payload.transaction_state;
      if (state && String(state).toUpperCase() === "APPROVED") {
        row.hasSuccessfulTransaction = true;
      }
    }
  }

  // ── Private: session type detection ──

  private detectSessionType(
    row: CheckoutSessionMetadata,
    payload: Record<string, unknown>,
  ): void {
    const request = payload.request as Record<string, unknown> | undefined;
    const requestBody = request?.body as Record<string, unknown> | undefined;
    if (!requestBody) return;

    const subscription = requestBody.subscription as
      | Record<string, unknown>
      | undefined;
    const payment = requestBody.payment as Record<string, unknown> | undefined;

    if (subscription || payment?.subscribe === true) {
      row.sessionType = "SUBSCRIPTION";
      if (subscription?.reference)
        row.reference = String(subscription.reference);
      else if (payment?.reference) row.reference = String(payment.reference);
    } else if (payment?.agreement) {
      row.sessionType = "AUTOPAY";
      if (payment.reference) row.reference = String(payment.reference);
    } else if (payment && row.sessionType === "UNKNOWN") {
      row.sessionType = "PAYMENT";
      if (payment.reference) row.reference = String(payment.reference);
    }
  }

  // ── Private: post-process defaults ──

  private applyFunnelTypeDefaults(
    sessionMap: Map<string, CheckoutSessionMetadata>,
  ): void {
    for (const row of sessionMap.values()) {
      const { steps, timings } = row;

      if (row.sessionType === "UNKNOWN") {
        if (steps.entry || steps.show) {
          row.sessionType = "PAYMENT";
        } else if (steps.process) {
          // Cobro sin paso por la SPA: nadie entró ni vio nada.
          row.sessionType = "COLLECT";
        }
      }

      if (timings.created !== undefined) {
        if (timings.entry !== undefined) {
          row.durations.timeToEntry = timings.entry - timings.created;
        }
        if (timings.show !== undefined) {
          row.durations.timeToShow = timings.show - timings.created;
        }
      }
    }
  }
}
