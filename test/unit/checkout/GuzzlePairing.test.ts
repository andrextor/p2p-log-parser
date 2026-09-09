import { P2PParserEngine } from "@/engine";
import { AppTypes } from "@/types";
import { describe, expect, it } from "vitest";

/**
 * Apple Pay, Google Pay y Click to Pay salen por `guzzle-logger` igual que el
 * gateway propio, pero con el mensaje redactado a su manera. Emparejarlas por
 * el texto dejaba fuera todo lo que no fuera el gateway.
 */
/** Envoltorio de Grafana: epoch, ISO y el JSON, separados por tabuladores. */
const line = (message: string, context: Record<string, unknown>, at: string) =>
  [
    Date.parse(at),
    new Date(at).toISOString(),
    JSON.stringify({
      message,
      context,
      level: 200,
      level_name: "INFO",
      channel: "production",
      datetime: at,
    }),
  ].join("\t");

const TRACE = "c4d04c51-625f-4323-a590-7d4b824bcbe0";
const URL = "https://apple-pay-gateway-cert.apple.com/paymentservices/startSession";

const request = {
  TENANT_DOMAIN: "checkout-test.placetopay.com",
  session_id: 3855793,
  request: { url: URL, method: "POST", body: { domainName: "checkout-test.placetopay.com" } },
  aws_request_id: TRACE,
};

const response = {
  TENANT_DOMAIN: "checkout-test.placetopay.com",
  session_id: 3855793,
  response: { url: URL, status_code: 200, body: { nonce: "e329418a" }, message: "OK" },
  aws_request_id: TRACE,
};

describe("emparejado de llamadas Guzzle en Checkout", () => {
  const engine = new P2PParserEngine();

  it("empareja aunque el mensaje no diga «HTTP Req»", () => {
    const raw = [
      line("Apple Pay session", request, "2026-09-08T17:13:22.000-05:00"),
      line("Apple Pay session", response, "2026-09-08T17:13:23.000-05:00"),
    ].join("\n");

    const events = engine.parse(raw, AppTypes.CHECKOUT).events;
    expect(events).toHaveLength(2);

    const [req, res] = events;
    expect(req.pairRole).toBe("request");
    expect(res.pairRole).toBe("response");
    expect(req.pairKey).toBeDefined();
    expect(req.pairKey).toBe(res.pairKey);
  });

  it("sigue emparejando el formato con marcador explicito", () => {
    const raw = [
      line("HTTP Req", request, "2026-09-08T17:13:22.000-05:00"),
      line("HTTP Res", response, "2026-09-08T17:13:23.000-05:00"),
    ].join("\n");

    const events = engine.parse(raw, AppTypes.CHECKOUT).events;
    expect(events[0].pairRole).toBe("request");
    expect(events[1].pairRole).toBe("response");
    expect(events[0].pairKey).toBe(events[1].pairKey);
  });

  it("sin aws_request_id no inventa un par", () => {
    const { aws_request_id, ...sinTraza } = request;
    const events = engine.parse(
      line("Apple Pay session", sinTraza, "2026-09-08T17:13:22.000-05:00"),
      AppTypes.CHECKOUT,
    ).events;
    expect(events[0]?.pairKey).toBeUndefined();
  });
});
