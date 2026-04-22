import { P2PParserEngine } from "@/engine";
import { AppTypes } from "@/types";
import { describe, expect, it } from "vitest";

describe("P2PParserEngine Grouping Logic", () => {
  it("should group events chronologically and create correct metadata", () => {
    const engine = new P2PParserEngine();

    // Minimal mock data that CheckoutLocalParser or others can detect
    // We'll use a mocked sequence of raw JSON logs (the engine detects JSON array strings or splits by line)
    // For simplicity, we just inject two simple matching strings. CheckoutLocalParser matches laravel standard log format sometimes or AWS CSV based on strategy.
    // Wait, the engine applies strategies. The Local Parser might not match random text, let's use Insights format

    const mockAwsInsights = `"Time","__log__grafana_internal__","__logstream__grafana_internal__","@message","session_id","Value"
2025-12-28 22:14:01,x,y,"{""message"":""placetopay_event"",""context"":{""type"":""checkout.session.created"",""data"":{""session_id"":111}},""level"":200,""datetime"":""2025-12-28T22:14:01.362-05""}",111,view
2025-12-28 22:14:05,x,y,"{""message"":""placetopay_event"",""context"":{""type"":""checkout.session.created"",""data"":{""session_id"":222}},""level"":200,""datetime"":""2025-12-28T22:14:05.362-05""}",222,view
2025-12-28 22:14:02,x,y,"{""message"":""placetopay_event"",""context"":{""type"":""checkout.session.entry"",""data"":{""session_id"":111}},""level"":200,""datetime"":""2025-12-28T22:14:02.116-05""}",111,view`;

    const result = engine.parse(mockAwsInsights, AppTypes.CHECKOUT);

    expect(result.events.length).toBe(3);

    expect(result.metadata).toBeDefined();
    const metadata = result.metadata as import("@/engine").CheckoutParseMetadata;
    expect(metadata.totalSessions).toBe(2);

    // sessionIds is no longer string[], it's an array of objects `sessions`.
    const sessionIds = metadata.sessions.map((s) => s.sessionId);
    expect(sessionIds).toContain("111");
    expect(sessionIds).toContain("222");

    // Let's assert the extracted data is mostly correct.
    const s111 = metadata.sessions.find(s => s.sessionId === "111");
    expect(s111?.sessionType).toBe("PAYMENT");
    expect(s111?.finalState).toBe("UNDEFINED");

    expect(result.groupedBySession).toBeDefined();
    if (!result.groupedBySession) return;

    // Check isolation
    const session111 = Object.values(result.groupedBySession["111"]).flat();
    expect(session111.length).toBe(2);

    const session222 = Object.values(result.groupedBySession["222"]).flat();
    expect(session222.length).toBe(1);

    // Check chronological sorting within the session block
    expect(session111[0].timestamp).toBe("2025-12-28T22:14:01.362-05");
    expect(session111[1].timestamp).toBe("2025-12-28T22:14:02.116-05");
  });

  it("should run gracefully and skip metadata if only one session exists", () => {
    const engine = new P2PParserEngine();
    const mockAwsInsights = `"Time","__log__grafana_internal__","__logstream__grafana_internal__","@message","session_id","Value"
2025-12-28 22:14:01,x,y,"{""message"":""placetopay_event"",""context"":{""type"":""checkout.session.created"",""data"":{""session_id"":333}},""level"":200,""datetime"":""2025-12-28T22:14:01.362-05""}",333,view`;

    const result = engine.parse(mockAwsInsights, AppTypes.CHECKOUT);

    expect(result.events.length).toBe(1);
    expect(result.metadata).toBeUndefined(); // Only injected when length > 1

    expect(result.groupedBySession).toBeDefined();
    if (!result.groupedBySession) return;
    const session333 = Object.values(result.groupedBySession["333"]).flat();
    expect(session333.length).toBe(1);
  });

  it("should tie-break identical timestamps using string comparison", () => {
    const engine = new P2PParserEngine();
    
    // Response comes first in log, but lexicographically its timestamp is greater (.882680 vs .882257)
    // This simulates AWS CloudWatch logs where multiple events in the same millisecond can arrive out of order
    const mockLog = [
      `2026-04-20 11:15:54,x,y,"{""message"":""[GW_LIB] HTTP Res"",""context"":{""session_id"":1},""level"":200,""datetime"":""2026-04-20T11:15:54.882680-05:00""}",1,view`,
      `2026-04-20 11:15:54,x,y,"{""message"":""[GW_LIB] HTTP Req"",""context"":{""session_id"":1},""level"":200,""datetime"":""2026-04-20T11:15:54.882257-05:00""}",1,view`
    ].join("\n");

    const result = engine.parse(mockLog, AppTypes.CHECKOUT);

    expect(result.events.length).toBe(2);
    // Req should come before Res due to the microsecond difference
    expect(result.events[0].message).toContain("Req");
    expect(result.events[1].message).toContain("Res");
  });

  it("should force Request before Response if timestamps are 100% identical", () => {
    const engine = new P2PParserEngine();
    
    // Both events have the exact same microsecond timestamp.
    // Response is parsed first from the text, but the engine should force Req before Res.
    const mockLog = [
      `2026-04-20 11:15:54,x,y,"{""message"":""[GW_LIB] HTTP Res"",""context"":{""session_id"":2},""level"":200,""datetime"":""2026-04-20T11:15:54.882-05:00""}",2,view`,
      `2026-04-20 11:15:54,x,y,"{""message"":""[GW_LIB] HTTP Req"",""context"":{""session_id"":2},""level"":200,""datetime"":""2026-04-20T11:15:54.882-05:00""}",2,view`
    ].join("\n");

    const result = engine.parse(mockLog, AppTypes.CHECKOUT);

    expect(result.events.length).toBe(2);
    // Even though timestamps are completely identical, Req should come first
    expect(result.events[0].message).toContain("Req");
    expect(result.events[1].message).toContain("Res");
  });

  it("should apply custom checkout actions from engine config", () => {
    const engine = new P2PParserEngine({
      customCheckoutActions: {
        "checkout.session.created": {
          message: "Custom Session Init",
          category: "HTTP_REQ_IN",
          source: "BACKEND",
        },
      },
    });

    const mockLog = `"Time","__log__grafana_internal__","__logstream__grafana_internal__","@message","session_id","Value"
2025-12-28 22:14:01,x,y,"{""message"":""placetopay_event"",""context"":{""type"":""checkout.session.created"",""data"":{""session_id"":444}},""level"":200,""datetime"":""2025-12-28T22:14:01.362-05""}",444,view`;

    const result = engine.parse(mockLog, AppTypes.CHECKOUT);

    expect(result.events.length).toBe(1);
    expect(result.events[0].message).toBe("Custom Session Init");
  });

  it("should preserve default actions when no custom config is provided", () => {
    const engine = new P2PParserEngine();

    const mockLog = `"Time","__log__grafana_internal__","__logstream__grafana_internal__","@message","session_id","Value"
2025-12-28 22:14:01,x,y,"{""message"":""placetopay_event"",""context"":{""type"":""checkout.session.created"",""data"":{""session_id"":555}},""level"":200,""datetime"":""2025-12-28T22:14:01.362-05""}",555,view`;

    const result = engine.parse(mockLog, AppTypes.CHECKOUT);

    expect(result.events.length).toBe(1);
    expect(result.events[0].message).toBe(
      "Session creation request: Flow initialization",
    );
  });

  it("should extract REST metadata correctly", () => {
    const engine = new P2PParserEngine();
    const mockRestLog = JSON.stringify([
      {
        message: '{"provider":"PLACETOPAY","operation":"QUERY_TRANSACTION"}',
        level: "info",
        messageId: "req-123",
        timestamp: "2025-12-28T22:14:01.000Z",
      },
    ]);

    const result = engine.parse(mockRestLog, AppTypes.REST);

    expect(result.events.length).toBe(1);
    expect(result.metadata).toBeDefined();
    const metadata = result.metadata as import("@/engine").RestParseMetadata;
    expect(metadata.totalOperations).toBe(1);
    expect(metadata.operations).toContain("QUERY_TRANSACTION");
    expect(metadata.providers).toContain("PLACETOPAY");
  });

  it("should extract session reference from request body", () => {
    const engine = new P2PParserEngine();
    const mockLog = [
      `2025-12-28 22:15:00,x,y,"{""message"":""placetopay_event"",""context"":{""session_id"":333,""request"":{""body"":{""payment"":{""reference"":""REF-123"",""subscribe"":false}}}},""level"":200,""timestamp"":""2025-12-28T22:15:00-05""}",333,view`,
      `2025-12-28 22:15:01,x,y,"{""message"":""placetopay_event"",""context"":{""session_id"":444,""request"":{""body"":{""subscription"":{""reference"":""SUB-456""}}}},""level"":200,""timestamp"":""2025-12-28T22:15:01-05""}",444,view`,
    ].join("\n");

    const result = engine.parse(mockLog, AppTypes.CHECKOUT);
    const metadata = result.metadata as import("@/engine").CheckoutParseMetadata;

    const s333 = metadata.sessions.find((s) => s.sessionId === "333");
    expect(s333?.reference).toBe("REF-123");

    const s444 = metadata.sessions.find((s) => s.sessionId === "444");
    expect(s444?.reference).toBe("SUB-456");
  });

  it("should return supported formats metadata for discovery", () => {
    const engine = new P2PParserEngine();
    const formats = engine.getSupportedFormats();

    expect(formats[AppTypes.CHECKOUT]).toBeDefined();
    expect(formats[AppTypes.CHECKOUT].some(f => f.name === "Grafana CSV Parser")).toBe(true);
    expect(formats[AppTypes.REST]).toBeDefined();
    expect(formats[AppTypes.REST][0].name).toBe("New Relic Parser");
  });
});
