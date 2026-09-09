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

    const req = events.find((e) => e.message.includes("HTTP Req"));
    const res = events.find((e) => e.message.includes("HTTP Res"));

    expect(req?.pairRole).toBe("request");
    expect(res?.pairRole).toBe("response");
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
