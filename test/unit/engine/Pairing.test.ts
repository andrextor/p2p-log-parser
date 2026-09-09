import { P2PParserEngine } from "@/engine";
import { AppTypes } from "@/types";
import { describe, expect, it } from "vitest";

/** Registro Atropos mínimo, en el formato JSON de New Relic. */
function sdkLog(action: string, at: string, operation = "sale") {
  return JSON.stringify({
    message: `INTERDIN ${action.toUpperCase()} t-1`,
    level: 200,
    datetime: at,
    context: {
      id: "t-1",
      provider: "INTERDIN",
      action,
      operation,
      context: { method: "POST", endpoint: "/authorize" },
    },
  });
}

const engine = new P2PParserEngine();

describe("Emparejamiento de intercambios", () => {
  it("marks a request with no response as PENDING", () => {
    const result = engine.parse(
      sdkLog("request", "2026-08-28T13:35:41.000-05:00"),
      AppTypes.REST,
    );

    expect(result.events[0].outcome?.status).toBe("PENDING");
    expect(result.events[0].durationMs).toBeUndefined();
  });

  it("consumes open requests in order, so a retry pairs with its own response", () => {
    // req1, req2, res1, res2: emparejar en pila uniría res1 con req2.
    const result = engine.parse(
      [
        sdkLog("request", "2026-08-28T13:35:41.000-05:00"),
        sdkLog("request", "2026-08-28T13:35:42.000-05:00"),
        sdkLog("response", "2026-08-28T13:35:43.000-05:00"),
        sdkLog("response", "2026-08-28T13:35:45.000-05:00"),
      ].join("\n"),
      AppTypes.REST,
    );

    const durations = result.events.map((e) => e.durationMs);
    expect(durations).toEqual([2000, 3000, 2000, 3000]);
    expect(result.events.some((e) => e.outcome?.status === "PENDING")).toBe(false);
  });

  it("does not pair records that lack a trace id", () => {
    const result = engine.parse(
      JSON.stringify({
        message: "HTTP Res",
        level: 200,
        datetime: "2026-08-28T13:35:41.000-05:00",
        context: { response: { status_code: 200 } },
      }),
      AppTypes.REST,
    );

    expect(result.events[0].pairKey).toBeUndefined();
  });

  it("reads the transfer time reported by HTTP Stats", () => {
    const result = engine.parse(
      JSON.stringify({
        message: "HTTP Stats",
        level: 100,
        datetime: "2026-08-28T13:35:41.000-05:00",
        context: { time: 1.2345, uri: "https://provider.example/authorize" },
      }),
      AppTypes.REST,
    );

    expect(result.events[0].durationMs).toBe(1235);
  });
});
