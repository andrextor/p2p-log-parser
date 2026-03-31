import { CheckoutInsightsParser } from "@/checkout/strategies/CheckoutInsightsParser";
import { describe, expect, it } from "vitest";

describe("CheckoutInsightsParser", () => {
  const parser = new CheckoutInsightsParser();

  it("should parse the old regex format", () => {
    const rawLine = `12345 2026-03-27T10:30:01.192337-05:00 {"message":"[GW_LIB] HTTP Except","context":{"session_id":69195063},"level_name":"ERROR","datetime":"2026-03-27T10:30:01.192337-05:00"}`;
    const result = parser.parse(rawLine);

    expect(result).not.toBeNull();
    expect(result?.timestamp).toBe("2026-03-27T10:30:01.192337-05:00");
    expect(result?.level).toBe("ERROR");
    expect(result?.message).toBe("[GW_LIB] HTTP Except");
    expect(result?.context.session_id).toBe(69195063);
    expect(result?.sourceType).toBe("AWS_CSV");
  });

  it("should parse the new JSON Insights format", () => {
    const rawLine = JSON.stringify({
      "@timestamp": "2026-03-27 15:30:01.254",
      "@message": {
        "message": "[GW_LIB] HTTP Except",
        "context": {
          "session_id": 69195063,
          "aws_request_id": "77cecf8c-e226-489e-9dec-76b733dcd096"
        },
        "level": 400,
        "level_name": "ERROR",
        "datetime": "2026-03-27T10:30:01.192337-05:00"
      }
    });

    const result = parser.parse(rawLine);

    expect(result).not.toBeNull();
    expect(result?.timestamp).toBe("2026-03-27T10:30:01.192337-05:00");
    expect(result?.level).toBe("ERROR");
    expect(result?.message).toBe("[GW_LIB] HTTP Except");
    expect(result?.context.session_id).toBe(69195063);
    expect(result?.sourceType).toBe("AWS_CSV");
  });

  it("should parse the new JSON Insights format when @message is a string", () => {
    const messageObj = {
      message: "some message",
      level_name: "INFO",
      context: { session_id: 111 }
    };
    const rawLine = JSON.stringify({
      "@timestamp": "2026-03-27 15:30:01.254",
      "@message": JSON.stringify(messageObj)
    });

    const result = parser.parse(rawLine);

    expect(result).not.toBeNull();
    expect(result?.timestamp).toBe("2026-03-27 15:30:01.254"); // Fallbacks to @timestamp if datetime doesn't exist
    expect(result?.level).toBe("INFO");
    expect(result?.message).toBe("some message");
    expect(result?.context.session_id).toBe(111);
  });

  it("should return null for invalid input", () => {
    expect(parser.parse("invalid line with no JSON or ID")).toBeNull();
    expect(parser.parse(`{"invalid":"json"`)).toBeNull(); // Missing closing brace
  });
});
