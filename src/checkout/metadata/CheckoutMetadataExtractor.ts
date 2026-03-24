import type {
  DomainMetadata,
  MetadataExtractor,
} from "@/common/metadata/MetadataExtractor";
import { AppTypes, type CheckoutDetails, type LogEvent } from "@/types";

export interface CheckoutSessionMetadata {
  sessionId: string;
  sessionType: "PAYMENT" | "COLLECT" | "SUBSCRIPTION" | "AUTOPAY" | "UNKNOWN";
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

export class CheckoutMetadataExtractor
  implements MetadataExtractor<CheckoutParseMetadata>
{
  readonly appType = AppTypes.CHECKOUT;

  extract(events: LogEvent[]): CheckoutParseMetadata | undefined {
    const sessionMap = new Map<string, CheckoutSessionMetadata>();
    const sessionSteps = new Map<
      string,
      { entry: boolean; show: boolean; process: boolean }
    >();

    for (const event of events) {
      if (event.appType !== AppTypes.CHECKOUT) continue;

      const details = event.details as CheckoutDetails;
      const sessionId = details?.sessionId;
      if (!sessionId) continue;

      const sid = String(sessionId);
      if (!sessionMap.has(sid)) {
        sessionMap.set(sid, {
          sessionId: sid,
          sessionType: "UNKNOWN",
          finalState: "UNDEFINED",
          hasSuccessfulTransaction: false,
          flags: {
            otp: false,
            threeDS: false,
            interest: false,
          },
        });
        sessionSteps.set(sid, { entry: false, show: false, process: false });
      }

      const row = sessionMap.get(sid);
      const steps = sessionSteps.get(sid);
      if (!row || !steps) continue;

      const endpoint = String(details.endpoint || "").toLowerCase();
      const ctx = event.context as Record<string, unknown>;
      const payload = (details.payload || {}) as Record<string, unknown>;
      const action = String(
        ctx?.action_method || payload?.action_method || "",
      ).toLowerCase();
      const subType = String(details.subType || "").toLowerCase();
      const msg = String(event.message || "").toLowerCase();
      const title = String(details.title || "").toLowerCase();

      // Funnel steps for Session Type
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

      // Feature Flags (OTP, 3DS, Interest)
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

      // Final State (from "Define session trace" or "Update session state trace")
      if (
        msg.includes("state update (session)") ||
        title.includes("session state trace") ||
        title.includes("define session trace")
      ) {
        const state =
          payload.new_state || payload.state_to_update || payload.session_state;
        if (state) {
          row.finalState = String(state).toUpperCase();
        }
      }

      // Transaction Status
      if (
        msg.includes("state update (transaction)") ||
        title.includes("update transaction trace")
      ) {
        const state = payload.state || payload.transaction_state;
        if (state && String(state).toUpperCase() === "APPROVED") {
          row.hasSuccessfulTransaction = true; // Mark as successful if ANY transaction was approved
        }
      }

      // Check for subscription / autopay in payload
      const request = payload.request as Record<string, unknown> | undefined;
      const requestBody = request?.body as Record<string, unknown> | undefined;
      if (requestBody) {
        const subscription = requestBody.subscription as
          | Record<string, unknown>
          | undefined;
        const payment = requestBody.payment as
          | Record<string, unknown>
          | undefined;

        if (subscription || payment?.subscribe === true) {
          row.sessionType = "SUBSCRIPTION";
          if (subscription?.reference)
            row.reference = String(subscription.reference);
          else if (payment?.reference)
            row.reference = String(payment.reference);
        } else if (payment && row.sessionType === "UNKNOWN") {
          row.sessionType = "PAYMENT";
          if (payment.reference) row.reference = String(payment.reference);
        }
      }
    }

    // Determine final session types via rules if not already set by explicit payload flags
    for (const sid of sessionMap.keys()) {
      const row = sessionMap.get(sid);
      const steps = sessionSteps.get(sid);
      if (!row || !steps) continue;

      if (row.sessionType === "UNKNOWN" || row.sessionType === "PAYMENT") {
        if (steps.process && !steps.entry && !steps.show) {
          row.sessionType = "COLLECT";
        } else if (
          (steps.entry || steps.show) &&
          row.sessionType === "UNKNOWN"
        ) {
          row.sessionType = "PAYMENT";
        }
      }
    }

    if (sessionMap.size < 2) return undefined;

    return {
      totalEvents: events.length,
      totalSessions: sessionMap.size,
      sessions: Array.from(sessionMap.values()),
    };
  }
}
