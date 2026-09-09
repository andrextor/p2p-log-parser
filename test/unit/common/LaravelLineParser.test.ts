import { LaravelLineParser } from "@/common/strategies/LaravelLineParser";
import { describe, expect, it } from "vitest";

describe("LaravelLineParser", () => {
  const parser = new LaravelLineParser();

  it("keeps Monolog `context` and `extra` separate", () => {
    const line =
      '[2025-12-28 22:14:01] production.INFO: placetopay_event {"session_id":123,"type":"checkout.session.entry"} {"tenantId":100}';

    const result = parser.parse(line);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.context).toEqual({
      session_id: 123,
      type: "checkout.session.entry",
    });
    // El bug anterior fusionaba ambos bloques: `tenantId` acababa en `context`.
    expect(result.context.tenantId).toBeUndefined();
    expect(result.extra).toEqual({ tenantId: 100 });
  });

  it("captures the Monolog channel as a provider hint", () => {
    const result = parser.parse(
      '[2025-12-28 22:14:01] interdin.WARNING: INTERDIN RESPONSE 8f3c {"provider":"INTERDIN"}',
    );

    expect(result?.channel).toBe("interdin");
    expect(result?.level).toBe("WARNING");
    expect(result?.message).toBe("INTERDIN RESPONSE 8f3c");
  });

  it("handles lines without any JSON block", () => {
    const result = parser.parse(
      "[2025-12-28 22:14:01] production.ERROR: Error resolving credit types",
    );

    expect(result?.message).toBe("Error resolving credit types");
    expect(result?.context).toEqual({});
    expect(result?.extra).toBeUndefined();
  });

  it("returns null for lines that are not Laravel logs", () => {
    expect(parser.parse('{"message":"json line"}')).toBeNull();
    expect(parser.parse("")).toBeNull();
  });
});
