import type {
  DomainMetadata,
  MetadataExtractor,
} from "@/common/metadata/MetadataExtractor";
import { AppTypes, type CheckoutDetails, type LogEvent } from "@/types";

export interface CheckoutSessionMetadata {
  sessionId: string;
  sessionType: "PAYMENT" | "SUBSCRIPTION" | "AUTOPAY" | "UNKNOWN";
  finalState: string;
  hasSuccessfulTransaction: boolean;
  reference?: string;
  flags: {
    otp: boolean;
    threeDS: boolean;
    interest: boolean;
  };
}

export interface CheckoutParseMetadata extends DomainMetadata {
  totalSessions: number;
  sessions: CheckoutSessionMetadata[];
}

interface FunnelSteps {
  entry: boolean;
  show: boolean;
  process: boolean;
}

export class CheckoutMetadataExtractor
  implements MetadataExtractor<CheckoutParseMetadata>
{
  readonly appType = AppTypes.CHECKOUT;

  extract(events: LogEvent[]): CheckoutParseMetadata | undefined {
    const sessionMap = new Map<string, CheckoutSessionMetadata>();
    const sessionSteps = new Map<string, FunnelSteps>();

    for (const event of events) {
      if (event.appType !== AppTypes.CHECKOUT) continue;

      const details = event.details as CheckoutDetails;
      const sessionId = details?.sessionId;
      if (!sessionId) continue;

      const sid = String(sessionId);

      if (!sessionMap.has(sid)) {
        sessionMap.set(sid, this.createEmptySession(sid));
        sessionSteps.set(sid, { entry: false, show: false, process: false });
      }

      const row = sessionMap.get(sid);
      const steps = sessionSteps.get(sid);
      if (!row || !steps) continue;

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

        this.detectFunnelSteps(steps, action, subType, endpoint);
        this.detectFlags(row, endpoint, action, msg);
        this.detectFinalState(row, msg, title, payload);
        this.detectTransactionStatus(row, msg, title, payload);
        this.detectSessionType(row, payload);
      } catch {
        // Skip events with malformed payload shapes
      }
    }

    this.applyFunnelTypeDefaults(sessionMap, sessionSteps);

    if (sessionMap.size < 2) return undefined;

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
      flags: { otp: false, threeDS: false, interest: false },
    };
  }

  // ── Private: funnel step detection ──

  private detectFunnelSteps(
    steps: FunnelSteps,
    action: string,
    subType: string,
    endpoint: string,
  ): void {
    if (action === "entry" || subType === "checkout.session.entry") {
      steps.entry = true;
    }
    if (action === "show") {
      steps.show = true;
    }
    if (
      action === "process" ||
      endpoint.includes("/process") ||
      endpoint.includes("/collect")
    ) {
      steps.process = true;
    }
  }

  // ── Private: feature flags ──

  private detectFlags(
    row: CheckoutSessionMetadata,
    endpoint: string,
    action: string,
    msg: string,
  ): void {
    if (
      endpoint.includes("/otp/generate") ||
      endpoint.includes("/otp/validate") ||
      action === "checkotp"
    ) {
      row.flags.otp = true;
    }
    if (endpoint.includes("/mpi/lookup") || msg.includes("3ds")) {
      row.flags.threeDS = true;
    }
    if (endpoint.includes("/interest")) {
      row.flags.interest = true;
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
    sessionSteps: Map<string, FunnelSteps>,
  ): void {
    for (const sid of sessionMap.keys()) {
      const row = sessionMap.get(sid);
      const steps = sessionSteps.get(sid);
      if (!row || !steps) continue;

      if (row.sessionType === "UNKNOWN") {
        if (steps.entry || steps.show || steps.process) {
          row.sessionType = "PAYMENT";
        }
      }
    }
  }
}
