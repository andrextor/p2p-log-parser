import { CheckoutGrafanaCsvParser } from "@/checkout/strategies/CheckoutGrafanaCsvParser";
import { describe, expect, it } from "vitest";

describe("CheckoutGrafanaCsvParser", () => {
  const parser = new CheckoutGrafanaCsvParser();

  it("should parse a standard Grafana CloudWatch CSV export line", () => {
    const sample = `"Time","__log__grafana_internal__","__logstream__grafana_internal__","@message","session_id","Value"
2025-12-28 22:14:01,583550948756:/aws/lambda/vapor-webcheckout-production-d,2025/12/29/[323]f3c7dd54111b47e09cabab0cbc018301,"{""message"":""placetopay_event"",""context"":{""TENANT_DOMAIN"":""checkout.placetopay.ec"",""type"":""checkout.session.created"",""data"":{""session_id"":64495486,""site_id"":6005},""aws_request_id"":""7a624953-7604-4457-a6a5-113ed2c32f69""},""level"":200,""level_name"":""INFO"",""channel"":""production"",""datetime"":""2025-12-28T22:14:01.362926-05:00"",""extra"":{""tenantId"":100}}",64495486,View this query in CloudWatch console`;

    // Only testing the second line
    const lines = sample.split("\n");
    const result = parser.parse(lines[1]);

    expect(result).not.toBeNull();
    if (result) {
      expect(result.timestamp).toBe("2025-12-28T22:14:01.362926-05:00");
      expect(result.level).toBe("INFO");
      expect(result.message).toBe("placetopay_event");
      expect(result.sourceType).toBe("GRAFANA_CSV");
      expect((result.context as any).TENANT_DOMAIN).toBe("checkout.placetopay.ec");
    }
  });

  it("should ignore header lines", () => {
    const header = `"Time","__log__grafana_internal__","__logstream__grafana_internal__","@message","session_id","Value"`;
    expect(parser.parse(header)).toBeNull();
  });

  it("should handle lines without the JSON marker", () => {
    const invalid = "2025-12-28 22:14:01,some,other,data,no,json";
    expect(parser.parse(invalid)).toBeNull();
  });

  it("should unescape double-double quotes correctly", () => {
    const line = `2025-12-28 22:14:01,log,stream,"{""foo"":""bar"",""nested"":{""key"":""val""}}",123,Value`;
    const result = parser.parse(line);
    expect(result).not.toBeNull();
    if (result) {
      expect((result.context as any).foo).toBe("bar");
      expect((result.context as any).nested.key).toBe("val");
    }
  });
});
