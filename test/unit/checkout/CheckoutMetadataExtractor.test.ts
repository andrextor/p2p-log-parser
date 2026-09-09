import { CheckoutMetadataExtractor } from "@/checkout/metadata/CheckoutMetadataExtractor";
import { AppTypes, type LogEvent } from "@/types";
import { describe, expect, it } from "vitest";

describe("CheckoutMetadataExtractor", () => {
  const extractor = new CheckoutMetadataExtractor();

  it("should identify PAYMENT session type", () => {
    const events: LogEvent[] = [
      {
        id: "1",
        category: "GENERIC",
        appType: AppTypes.CHECKOUT,
        message: "placetopay_event",
        context: { action_method: "entry" },
        details: { sessionId: "123" },
        timestamp: "2024-03-30T10:00:00Z",
        level: "INFO",
        ts: 0,
        correlation: {},
      },
      {
        id: "2",
        category: "GENERIC",
        appType: AppTypes.CHECKOUT,
        message: "placetopay_event",
        context: { action_method: "show" },
        details: { sessionId: "123" },
        timestamp: "2024-03-30T10:00:01Z",
        level: "INFO",
        ts: 0,
        correlation: {},
      },
      {
        id: "3",
        category: "GENERIC",
        appType: AppTypes.CHECKOUT,
        message: "dummy event for another session",
        context: {},
        details: { sessionId: "456" },
        timestamp: "2024-03-30T10:00:02Z",
        level: "INFO",
        ts: 0,
        correlation: {},
      }
    ];

    const metadata = extractor.extract(events);
    expect(metadata?.sessions.find(s => s.sessionId === "123")?.sessionType).toBe("PAYMENT");
  });

  it("should identify SUBSCRIPTION session type", () => {
    const events: LogEvent[] = [
      {
        id: "4",
        category: "GENERIC",
        appType: AppTypes.CHECKOUT,
        message: "placetopay_event",
        context: {},
        details: {
          sessionId: "123",
          payload: {
            request: {
              body: {
                subscription: { reference: "SUB-1" }
              }
            }
          }
        },
        timestamp: "2024-03-30T10:00:00Z",
        level: "INFO",
        ts: 0,
        correlation: {},
      },
      {
        id: "5",
        category: "GENERIC",
        appType: AppTypes.CHECKOUT,
        message: "placetopay_event",
        context: {},
        details: {
          sessionId: "123",
          payload: {
            request: {
              body: {
                payment: { subscribe: true, reference: "SUB-1" }
              }
            }
          }
        },
        timestamp: "2024-03-30T10:00:01Z",
        level: "INFO",
        ts: 0,
        correlation: {},
      },
      {
        id: "6",
        category: "GENERIC",
        appType: AppTypes.CHECKOUT,
        message: "dummy",
        context: {},
        details: { sessionId: "456" },
        timestamp: "2024-03-30T10:00:02Z",
        level: "INFO",
        ts: 0,
        correlation: {},
      }
    ];

    const metadata = extractor.extract(events);
    const session = metadata?.sessions.find(s => s.sessionId === "123");
    expect(session?.sessionType).toBe("SUBSCRIPTION");
    expect(session?.reference).toBe("SUB-1");
  });

  it("should identify AUTOPAY session type (planned)", () => {
    const events: LogEvent[] = [
      {
        id: "7",
        category: "GENERIC",
        appType: AppTypes.CHECKOUT,
        message: "placetopay_event",
        context: {},
        details: {
          sessionId: "123",
          payload: {
            request: {
              body: {
                payment: { agreement: "AGREE-1", reference: "AGREE-REF-1" }
              }
            }
          }
        },
        timestamp: "2024-03-30T10:00:00Z",
        level: "INFO",
        ts: 0,
        correlation: {},
      },
      {
        id: "8",
        category: "GENERIC",
        appType: AppTypes.CHECKOUT,
        message: "dummy",
        context: {},
        details: { sessionId: "456" },
        timestamp: "2024-03-30T10:00:02Z",
        level: "INFO",
        ts: 0,
        correlation: {},
      }
    ];

    const metadata = extractor.extract(events);
    expect(metadata).toBeDefined();
    expect(metadata?.sessions.find(s => s.sessionId === "123")?.sessionType).toBe("AUTOPAY");
    expect(metadata?.sessions.find(s => s.sessionId === "123")?.reference).toBe("AGREE-REF-1");
  });

  const ev = (
    id: string,
    ts: number,
    details: Record<string, unknown>,
    context: Record<string, unknown> = {},
  ): LogEvent =>
    ({
      id,
      category: "GENERIC",
      appType: AppTypes.CHECKOUT,
      message: "placetopay_event",
      context,
      details,
      timestamp: new Date(ts).toISOString(),
      level: "INFO",
      ts,
      correlation: {},
    }) as LogEvent;

  it("marca los ocho hitos del embudo", () => {
    const metadata = extractor.extract([
      ev("a", 0, { sessionId: "s1", subType: "checkout.session.created" }),
      ev("b", 1000, { sessionId: "s1" }, { action_method: "entry" }),
      ev("c", 3000, { sessionId: "s1" }, { action_method: "show" }),
      ev("d", 4000, { sessionId: "s1", endpoint: "/api/information" }),
      ev("e", 5000, { sessionId: "s1", endpoint: "/api/interest" }),
      ev("f", 6000, { sessionId: "s1", endpoint: "/api/otp/generate" }),
      ev("g", 7000, { sessionId: "s1", endpoint: "/api/mpi/lookup" }),
      ev("h", 8000, { sessionId: "s1", endpoint: "/api/process" }),
    ]);

    expect(metadata?.sessions.find(s => s.sessionId === "s1")?.steps).toEqual({
      created: true,
      entry: true,
      show: true,
      information: true,
      interest: true,
      otp: true,
      threeDS: true,
      process: true,
    });
  });

  it("mide las duraciones desde el primer evento de cada hito", () => {
    const metadata = extractor.extract([
      ev("a", 1000, { sessionId: "s1", subType: "checkout.session.created" }),
      ev("b", 3500, { sessionId: "s1" }, { action_method: "entry" }),
      // Un segundo `entry` no debe mover la marca: interesa el primero.
      ev("c", 9000, { sessionId: "s1" }, { action_method: "entry" }),
      ev("d", 6000, { sessionId: "s1" }, { action_method: "show" }),
    ]);

    const session = metadata?.sessions.find(s => s.sessionId === "s1");
    expect(session?.durations.timeToEntry).toBe(2500);
    expect(session?.durations.timeToShow).toBe(5000);
  });

  it("sin `created` no inventa duraciones", () => {
    const metadata = extractor.extract([
      ev("a", 1000, { sessionId: "s1" }, { action_method: "entry" }),
    ]);

    const session = metadata?.sessions.find(s => s.sessionId === "s1");
    expect(session?.durations.timeToEntry).toBeUndefined();
    expect(session?.timings.entry).toBe(1000);
  });

  it("un proceso sin paso por la SPA es COLLECT", () => {
    const metadata = extractor.extract([
      ev("a", 0, { sessionId: "s1", endpoint: "/api/collect" }),
    ]);

    expect(metadata?.sessions.find(s => s.sessionId === "s1")?.sessionType).toBe("COLLECT");
  });
});
