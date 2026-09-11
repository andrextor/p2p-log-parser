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

/** Los hitos en el orden del flujo; `lastStep` es el más lejano alcanzado. */
export const CHECKOUT_FUNNEL_ORDER: ReadonlyArray<keyof CheckoutFunnelSteps> = [
  "created",
  "entry",
  "show",
  "information",
  "interest",
  "otp",
  "threeDS",
  "process",
];

/**
 * Cómo acabó la sesión para quien lee el embudo. Los cuatro primeros son el
 * estado de la transacción; `EXPIRED` y `ABANDONED` son sesiones que nunca
 * llegaron a procesar; `UNKNOWN` es que se procesó pero el log no trae la
 * resolución (export recortado o estado que no conocemos).
 */
export type CheckoutSessionOutcome =
  | "APPROVED"
  | "REJECTED"
  | "PENDING"
  | "FAILED"
  | "EXPIRED"
  | "ABANDONED"
  | "UNKNOWN";

const TRANSACTION_OUTCOMES: ReadonlySet<string> = new Set([
  "APPROVED",
  "REJECTED",
  "PENDING",
  "FAILED",
]);

export interface CheckoutSessionMetadata {
  sessionId: string;
  sessionType: "PAYMENT" | "COLLECT" | "SUBSCRIPTION" | "AUTOPAY" | "UNKNOWN";
  /**
   * Estado interno de la sesión (`CREATED`, `PENDING`, `FINISHED`,
   * `EXPIRED`…). No dice si se pagó: `FINISHED` vale igual para una aprobada
   * que para una rechazada. Para eso está `outcome`.
   */
  finalState: string;
  /**
   * Estado de la última transacción resuelta (`APPROVED`, `REJECTED`,
   * `PENDING`, `FAILED`), tal como lo escribe `Update transaction trace`.
   * `null` si la sesión nunca procesó. Gana la última por orden cronológico:
   * un rechazo seguido de un reintento aprobado acaba en `APPROVED`.
   */
  transactionStatus: string | null;
  hasSuccessfulTransaction: boolean;
  outcome: CheckoutSessionOutcome;
  /** Último hito alcanzado en el orden del flujo; `null` si ninguno. */
  lastStep: keyof CheckoutFunnelSteps | null;
  reference?: string;
  steps: CheckoutFunnelSteps;
  /**
   * Epoch ms del primer evento de cada hito, más los extremos de la sesión.
   * Ausente si el hito no ocurrió.
   */
  timings: {
    created?: number;
    entry?: number;
    show?: number;
    process?: number;
    firstEvent?: number;
    lastEvent?: number;
  };
  /** Derivadas de `timings`, en ms. Ausentes si falta alguno de los extremos. */
  durations: {
    timeToEntry?: number;
    timeToShow?: number;
    timeToProcess?: number;
    /** Del primer al último evento de la sesión en el lote. */
    total?: number;
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

        this.trackSpan(row, event.ts);
        this.detectFunnelSteps(row, action, subType, endpoint, msg, event.ts);
        this.detectFinalState(row, msg, title, subType, payload);
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
      transactionStatus: null,
      hasSuccessfulTransaction: false,
      outcome: "ABANDONED",
      lastStep: null,
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

  // ── Private: session span ──

  private trackSpan(row: CheckoutSessionMetadata, ts?: number): void {
    if (ts === undefined || Number.isNaN(ts)) return;
    const { timings } = row;
    if (timings.firstEvent === undefined || ts < timings.firstEvent) {
      timings.firstEvent = ts;
    }
    if (timings.lastEvent === undefined || ts > timings.lastEvent) {
      timings.lastEvent = ts;
    }
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

    // Se fechan los hitos que son extremo de alguna duración: los tres que
    // abren el flujo y el pago. El resto se responde con un sí/no.
    const mark = (key: "created" | "entry" | "show" | "process") => {
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
    // «Opening 3DS» es el mensaje con que el mapper etiqueta la apertura del
    // reto. Buscar «3ds» a secas marcaba también el retorno al comercio, que
    // se etiqueta «Gateway Return (3DS / Redirection)» aunque no hubiera 3DS.
    if (endpoint.includes("/mpi/lookup") || msg.includes("opening 3ds")) {
      steps.threeDS = true;
    }
    if (
      action === "process" ||
      endpoint.includes("/process") ||
      endpoint.includes("/collect")
    ) {
      mark("process");
    }
  }

  // ── Private: final state detection ──

  private detectFinalState(
    row: CheckoutSessionMetadata,
    msg: string,
    title: string,
    subType: string,
    payload: Record<string, unknown>,
  ): void {
    if (subType === "checkout.session.expired") {
      row.finalState = "EXPIRED";
      return;
    }
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
      if (!state) return;
      row.transactionStatus = String(state).toUpperCase();
      if (row.transactionStatus === "APPROVED") {
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
        if (timings.process !== undefined) {
          row.durations.timeToProcess = timings.process - timings.created;
        }
      }
      if (timings.firstEvent !== undefined && timings.lastEvent !== undefined) {
        row.durations.total = timings.lastEvent - timings.firstEvent;
      }

      row.lastStep = this.resolveLastStep(steps);
      row.outcome = this.resolveOutcome(row);
    }
  }

  private resolveLastStep(
    steps: CheckoutFunnelSteps,
  ): keyof CheckoutFunnelSteps | null {
    let last: keyof CheckoutFunnelSteps | null = null;
    for (const key of CHECKOUT_FUNNEL_ORDER) {
      if (steps[key]) last = key;
    }
    return last;
  }

  /**
   * Procesó → manda la transacción. No procesó → expiró o se abandonó.
   * `hasSuccessfulTransaction` se mantiene por compatibilidad; es `outcome
   * === "APPROVED"`.
   */
  private resolveOutcome(row: CheckoutSessionMetadata): CheckoutSessionOutcome {
    if (row.steps.process) {
      const status = row.transactionStatus;
      return status && TRANSACTION_OUTCOMES.has(status)
        ? (status as CheckoutSessionOutcome)
        : "UNKNOWN";
    }
    return row.finalState === "EXPIRED" ? "EXPIRED" : "ABANDONED";
  }
}
