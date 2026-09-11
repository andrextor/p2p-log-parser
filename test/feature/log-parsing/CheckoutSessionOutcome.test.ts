import * as fs from "node:fs";
import * as path from "node:path";
import type { CheckoutParseMetadata } from "@/engine";
import { P2PParserEngine } from "@/engine";
import { CheckoutMetadataExtractor } from "@/checkout/metadata/CheckoutMetadataExtractor";
import { AppTypes, type LogEvent } from "@/types";
import { describe, expect, it } from "vitest";

/**
 * Export real de Grafana de una sesión de pruebas que acabó aprobada, con el
 * login del comercio anonimizado. Es el contrato del emisor para el resultado
 * de una sesión: `Update transaction trace: Transaction resolved` trae el
 * `state`, y `Update session state trace` el estado interno.
 */
const approved = () => {
  const csv = fs.readFileSync(
    path.resolve(__dirname, "../../fixtures/checkout-approved-session.csv"),
    "utf-8",
  );
  const result = new P2PParserEngine().parse(csv, AppTypes.CHECKOUT);
  const meta = result.metadata as CheckoutParseMetadata;
  const session = meta.sessions.find((s) => s.sessionId === "3858628");
  if (!session) throw new Error("sesión 3858628 no encontrada");
  return session;
};

describe("resultado de la sesión de checkout", () => {
  it("una sesión aprobada acaba en APPROVED, no solo en «procesó»", () => {
    const s = approved();
    expect(s.steps.process).toBe(true);
    expect(s.transactionStatus).toBe("APPROVED");
    expect(s.outcome).toBe("APPROVED");
    expect(s.hasSuccessfulTransaction).toBe(true);
    expect(s.finalState).toBe("FINISHED");
    expect(s.lastStep).toBe("process");
  });

  it("«Transaction resolved» correlaciona por el placetopay_id recién asignado", () => {
    const csv = fs.readFileSync(
      path.resolve(__dirname, "../../fixtures/checkout-approved-session.csv"),
      "utf-8",
    );
    const { events } = new P2PParserEngine().parse(csv, AppTypes.CHECKOUT);
    const resolved = events.find((e) =>
      e.details.rawTitle?.includes("Transaction resolved"),
    );
    // La línea trae `placetopay_id: null` y `updated_placetopay_id: 1599893053`.
    expect(resolved?.correlation.placetopayId).toBe("1599893053");
  });

  it("el retorno al comercio no cuenta como 3DS", () => {
    // El log trae `threeDS: "unsupported"` y un POST …/return del
    // ReturnController; antes ese mensaje marcaba el hito por contener «3DS».
    expect(approved().steps.threeDS).toBe(false);
  });

  it("fecha el pago y mide el total de la sesión", () => {
    const { timings, durations } = approved();
    expect(timings.process).toBeDefined();
    expect(durations.timeToProcess).toBeGreaterThan(durations.timeToShow ?? 0);
    // created 15:22:10.298 → sessionInformation 15:22:36.084
    expect(durations.total).toBe(25786);
  });
});

describe("resolveOutcome", () => {
  const extractor = new CheckoutMetadataExtractor();
  const ev = (
    id: string,
    over: Partial<LogEvent> & { details?: Record<string, unknown> },
  ): LogEvent => ({
    id,
    category: "GENERIC",
    appType: AppTypes.CHECKOUT,
    message: "",
    context: {},
    timestamp: "",
    level: "INFO",
    ts: 0,
    correlation: {},
    ...over,
    details: { sessionId: "1", ...over.details },
  });
  const outcomeOf = (events: LogEvent[]) =>
    extractor.extract(events)?.sessions[0];

  it("un rechazo seguido de un reintento aprobado acaba en APPROVED", () => {
    const s = outcomeOf([
      ev("p", { context: { action_method: "process" }, ts: 1 }),
      ev("r", {
        details: { title: "Update transaction trace: Transaction resolved", payload: { state: "REJECTED" } },
        ts: 2,
      }),
      ev("a", {
        details: { title: "Update transaction trace: Transaction resolved", payload: { state: "APPROVED" } },
        ts: 3,
      }),
    ]);
    expect(s?.transactionStatus).toBe("APPROVED");
    expect(s?.outcome).toBe("APPROVED");
  });

  it("un rechazo sin reintento acaba en REJECTED", () => {
    const s = outcomeOf([
      ev("p", { context: { action_method: "process" } }),
      ev("r", {
        details: { title: "Update transaction trace: Transaction resolved", payload: { state: "REJECTED" } },
      }),
    ]);
    expect(s?.outcome).toBe("REJECTED");
    expect(s?.hasSuccessfulTransaction).toBe(false);
  });

  it("procesó pero el log no trae la resolución → UNKNOWN", () => {
    const s = outcomeOf([ev("p", { context: { action_method: "process" } })]);
    expect(s?.outcome).toBe("UNKNOWN");
    expect(s?.transactionStatus).toBeNull();
  });

  it("no procesó → ABANDONED en el último hito alcanzado", () => {
    const s = outcomeOf([
      ev("e", { context: { action_method: "entry" } }),
      ev("s", { context: { action_method: "show" } }),
      ev("i", { details: { endpoint: "/api/v4/session/1/x/information" } }),
    ]);
    expect(s?.outcome).toBe("ABANDONED");
    expect(s?.lastStep).toBe("information");
  });

  it("no procesó y expiró → EXPIRED", () => {
    const s = outcomeOf([
      ev("e", { context: { action_method: "entry" } }),
      ev("x", { details: { subType: "checkout.session.expired" } }),
    ]);
    expect(s?.outcome).toBe("EXPIRED");
    expect(s?.finalState).toBe("EXPIRED");
  });
});
