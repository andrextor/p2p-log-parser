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
    expect(result.metadata?.totalSessions).toBe(2);
    expect(result.metadata?.sessionIds).toContain("111");
    expect(result.metadata?.sessionIds).toContain("222");

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
});
