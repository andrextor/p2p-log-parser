import { describe, expect, it } from "vitest";
import { CheckoutGrafanaJsonParser } from "../../../../src/checkout/strategies/CheckoutGrafanaJsonParser";

describe("CheckoutGrafanaJsonParser", () => {
  const parser = new CheckoutGrafanaJsonParser();

  it("should match valid grafana json format", () => {
    const raw = `1774921157476\t2026-03-31T01:39:17.476Z\t{"message":"Request trace POST /api/session/7532375","context":{"TENANT_DOMAIN":"checkout.getnet.cl","session_id":7532375,"action_method":"sessionInformation","body":{"auth":{"login":"vz3gNGDF8UKbfuRPA4u1tLes8KQqR59Z"},"browser":"RestSharp","platform":null,"version":"106.15.0.0"},"aws_request_id":"835b702e-bdf8-4423-b427-c8c86afb156c"},"level":200,"level_name":"INFO","channel":"production","datetime":"2026-03-31T01:39:17.439379+00:00","extra":{"tenantId":2}}`;
    const result = parser.parse(raw);

    expect(result).toBeDefined();
    expect(result?.sourceType).toBe("GRAFANA_JSON");
    expect(result?.message).toBe("Request trace POST /api/session/7532375");
    expect(result?.level).toBe("INFO");
    expect(result?.timestamp).toBe("2026-03-31T01:39:17.439379+00:00");
    expect(result?.context).toBeDefined();
    expect((result?.context as any).aws_request_id).toBe("835b702e-bdf8-4423-b427-c8c86afb156c");
  });

  it("should reject invalid formats", () => {
    // Missing json bracket
    expect(parser.parse("1774921157476\t2026-03-31T01:39:17.476Z\tmessage payload")).toBeNull();
    // Invalid json
    expect(parser.parse("1774921157476\t2026-03-31T01:39:17.476Z\t{\"message\": \"bad json\"")).toBeNull();
    // Missing timestamp
    expect(parser.parse("Just some random text without timestamp or json payload")).toBeNull();
  });

  it("should format timestamps correctly when json datetime is missing", () => {
    const raw = `1774921157476\t2026-03-31T01:39:17.476Z\t{"message":"Test message","level":200,"level_name":"INFO"}`;
    const result = parser.parse(raw);

    expect(result).toBeDefined();
    expect(result?.timestamp).toBe("2026-03-31T01:39:17.476Z");
  });
  
  it("should provide correct metadata", () => {
    const meta = parser.getMetadata();
    expect(meta.name).toBe("Grafana JSON Parser");
  });
});
