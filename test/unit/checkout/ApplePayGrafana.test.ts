import { P2PParserEngine } from "@/engine";
import { AppTypes } from "@/types";
import { describe, expect, it } from "vitest";

/**
 * Export real de Grafana con la llamada de Apple Pay. El mensaje lleva `HTTP
 * Req` pero con prefijo de integración (`APPLE_PAY-SDK: `), que es justo lo que
 * la comparación por igualdad exacta dejaba fuera.
 */
const RAW = [
  "\"Time\",\"__log__grafana_internal__\",\"__logstream__grafana_internal__\",\"@message\"",
  "2026-09-09 14:36:49,583550948756:/aws/lambda/vapor-webcheckout-test-d,2026/09/09/[867]6a3cc112,\"{\"\"message\"\": \"\"APPLE_PAY-SDK: HTTP Req\"\", \"\"context\"\": {\"\"TENANT_DOMAIN\"\": \"\"checkout-test.placetopay.com\"\", \"\"session_id\"\": 3856691, \"\"request\"\": {\"\"url\"\": \"\"https://apple-pay-gateway-cert.apple.com/paymentservices/startSession\"\", \"\"method\"\": \"\"POST\"\", \"\"body\"\": {\"\"merchantIdentifier\"\": \"\"merchant.com.placetopay.checkout-test\"\"}}, \"\"aws_request_id\"\": \"\"f4eee73b-bf33-4919-8168-424c18450b33\"\"}, \"\"level\"\": 200, \"\"level_name\"\": \"\"INFO\"\", \"\"channel\"\": \"\"test\"\", \"\"datetime\"\": \"\"2026-09-09T14:36:49.407136-05:00\"\", \"\"extra\"\": {\"\"tenantId\"\": 50}}\"",
  "2026-09-09 14:36:49,583550948756:/aws/lambda/vapor-webcheckout-test-d,2026/09/09/[867]6a3cc112,\"{\"\"message\"\": \"\"APPLE_PAY-SDK: HTTP Res\"\", \"\"context\"\": {\"\"TENANT_DOMAIN\"\": \"\"checkout-test.placetopay.com\"\", \"\"session_id\"\": 3856691, \"\"response\"\": {\"\"url\"\": \"\"https://apple-pay-gateway-cert.apple.com/paymentservices/startSession\"\", \"\"status_code\"\": 200, \"\"body\"\": {\"\"nonce\"\": \"\"c04f22ce\"\"}, \"\"message\"\": \"\"OK\"\"}, \"\"aws_request_id\"\": \"\"f4eee73b-bf33-4919-8168-424c18450b33\"\"}, \"\"level\"\": 200, \"\"level_name\"\": \"\"INFO\"\", \"\"channel\"\": \"\"test\"\", \"\"datetime\"\": \"\"2026-09-09T14:36:49.507528-05:00\"\", \"\"extra\"\": {\"\"tenantId\"\": 50}}\"",
  "2026-09-09 14:36:49,583550948756:/aws/lambda/vapor-webcheckout-test-d,2026/09/09/[867]6a3cc112,\"{\"\"message\"\": \"\"Request trace POST /api/v4/session/3856691/abc/wallet/apple-pay-validate-merchant\"\", \"\"context\"\": {\"\"TENANT_DOMAIN\"\": \"\"checkout-test.placetopay.com\"\", \"\"session_id\"\": 3856691, \"\"action_method\"\": \"\"validateMerchant\"\", \"\"body\"\": [], \"\"aws_request_id\"\": \"\"f4eee73b-bf33-4919-8168-424c18450b33\"\"}, \"\"level\"\": 200, \"\"level_name\"\": \"\"INFO\"\", \"\"channel\"\": \"\"test\"\", \"\"datetime\"\": \"\"2026-09-09T14:36:49.159025-05:00\"\", \"\"extra\"\": {\"\"tenantId\"\": 50}}\"",
].join("\n");

describe("Apple Pay en un export de Grafana", () => {
  const engine = new P2PParserEngine();

  it("empareja la ida y la vuelta del SDK", () => {
    const events = engine.parse(RAW, AppTypes.CHECKOUT).events;

    const req = events.find((e) => e.pairRole === "request");
    const res = events.find((e) => e.pairRole === "response");

    expect(req).toBeDefined();
    expect(res).toBeDefined();
    expect(req?.pairKey).toBeDefined();
    expect(req?.pairKey).toBe(res?.pairKey);
    expect(res?.durationMs).toBeGreaterThan(0);
  });

  it("no arrastra al «Request trace» que comparte la misma traza", () => {
    const events = engine.parse(RAW, AppTypes.CHECKOUT).events;

    // Comparte `aws_request_id` con la llamada al SDK, pero es un registro
    // unico: no tiene con quien emparejarse y no debe inventarse pareja.
    const trace = events.find((e) => e.message.startsWith("Request trace"));
    expect(trace).toBeDefined();
    expect(trace?.pairKey).toBeUndefined();
  });
});

/** Llamada del Core API que no es `/core/tokenize`: se quedaba sin titulo. */
const CORE = [
  "\"Time\",\"__log__grafana_internal__\",\"__logstream__grafana_internal__\",\"@message\"",
  "2026-09-09 14:44:39,583550948756:/aws/lambda/vapor-webcheckout-test-d,2026/09/09/[867]aaa,\"{\"\"message\"\": \"\"HTTP Req\"\", \"\"context\"\": {\"\"TENANT_DOMAIN\"\": \"\"checkout-test.placetopay.com\"\", \"\"session_id\"\": 3856697, \"\"request\"\": {\"\"url\"\": \"\"https://api-test.placetopay.com/core/ads/search\"\", \"\"method\"\": \"\"POST\"\", \"\"body\"\": {\"\"auth\"\": {\"\"login\"\": \"\"placetopay_redirection\"\"}}}, \"\"aws_request_id\"\": \"\"1716a77b-9761-4ecb-a029-c68a8eda3db0\"\"}, \"\"level\"\": 200, \"\"level_name\"\": \"\"INFO\"\", \"\"channel\"\": \"\"test\"\", \"\"datetime\"\": \"\"2026-09-09T14:44:39.100000-05:00\"\", \"\"extra\"\": {\"\"tenantId\"\": 50}}\"",
  "2026-09-09 14:44:39,583550948756:/aws/lambda/vapor-webcheckout-test-d,2026/09/09/[867]aaa,\"{\"\"message\"\": \"\"HTTP Res\"\", \"\"context\"\": {\"\"TENANT_DOMAIN\"\": \"\"checkout-test.placetopay.com\"\", \"\"session_id\"\": 3856697, \"\"response\"\": {\"\"url\"\": \"\"https://api-test.placetopay.com/core/ads/search\"\", \"\"status_code\"\": 404, \"\"body\"\": {\"\"status\"\": {\"\"status\"\": \"\"FAILED\"\", \"\"reason\"\": \"\"XH\"\", \"\"message\"\": \"\"The route core/ads/search could not be found.\"\"}}, \"\"message\"\": \"\"Not Found\"\"}, \"\"aws_request_id\"\": \"\"1716a77b-9761-4ecb-a029-c68a8eda3db0\"\"}, \"\"level\"\": 200, \"\"level_name\"\": \"\"INFO\"\", \"\"channel\"\": \"\"test\"\", \"\"datetime\"\": \"\"2026-09-09T14:44:39.250000-05:00\"\", \"\"extra\"\": {\"\"tenantId\"\": 50}}\"",
].join("\n");

describe("Core API en Checkout", () => {
  const engine = new P2PParserEngine();
  const events = () => engine.parse(CORE, AppTypes.CHECKOUT).events;

  it("da titulo legible en vez de «HTTP Req» a secas", () => {
    const [req, res] = events();
    expect(req.message).toBe("CORE_API | POST /core/ads/search");
    expect(res.message).toBe("CORE_API | 404 Not Found");
  });

  it("identifica el servicio y clasifica bien la respuesta", () => {
    const [req, res] = events();
    const providerOf = (e: (typeof events extends () => infer R ? R : never)[number]) =>
      (e.details as { provider?: string }).provider;
    expect(providerOf(req)).toBe("CORE_API");
    expect(providerOf(res)).toBe("CORE_API");
    // Antes caia en BACKEND_LOG y la tarjeta no sabia que era una respuesta.
    expect(req.category).toBe("HTTP_REQ_OUT");
    expect(res.category).toBe("HTTP_RES");
  });

  it("mantiene el rechazo de negocio que trae el cuerpo", () => {
    const res = events()[1];
    expect(res.outcome?.isError).toBe(true);
    expect(res.outcome?.code).toBe("XH");
  });
});

describe("titulo de las llamadas del SDK", () => {
  const engine = new P2PParserEngine();

  it("nombra al proveedor a partir del prefijo del mensaje", () => {
    const events = engine.parse(RAW, AppTypes.CHECKOUT).events;
    const req = events.find((e) => e.pairRole === "request");
    const res = events.find((e) => e.pairRole === "response");

    // Antes se quedaban en «APPLE_PAY-SDK: HTTP Req» a secas.
    expect(req?.message).toBe("APPLE_PAY | POST /paymentservices/startSession");
    expect(res?.message).toBe("APPLE_PAY | 200 OK");
    expect((req?.details as { provider?: string }).provider).toBe("APPLE_PAY");
  });

  it("clasifica la respuesta como respuesta, no como log de backend", () => {
    const events = engine.parse(RAW, AppTypes.CHECKOUT).events;
    expect(events.find((e) => e.pairRole === "request")?.category).toBe("HTTP_REQ_OUT");
    expect(events.find((e) => e.pairRole === "response")?.category).toBe("HTTP_RES");
  });
});
