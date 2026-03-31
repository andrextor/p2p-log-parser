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
      }
    ];

    const metadata = extractor.extract(events);
    expect(metadata).toBeDefined();
    expect(metadata?.sessions.find(s => s.sessionId === "123")?.sessionType).toBe("AUTOPAY");
    expect(metadata?.sessions.find(s => s.sessionId === "123")?.reference).toBe("AGREE-REF-1");
  });
});
