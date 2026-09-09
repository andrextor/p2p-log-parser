import { CheckoutMapper } from "@/checkout/mappers/CheckoutMapper";
import { readTracePhase } from "@/checkout/constants/CheckoutTracePhases";
import type { CheckoutDetails, NormalizedLogData } from "@/types";
import { describe, expect, it } from "vitest";

const mapper = new CheckoutMapper();

function checkoutLog(
  message: string,
  context: Record<string, unknown> = {},
): NormalizedLogData {
  return {
    timestamp: "2026-08-28T13:35:41.000-05:00",
    level: "INFO",
    message,
    context: { session_id: 64495486, ...context },
    sourceType: "AWS_CSV",
  };
}

describe("readTracePhase", () => {
  it("splits the subject from the step", () => {
    expect(readTracePhase("Update transaction trace: Transaction resolved")).toEqual(
      {
        phase: "Transaction update",
        step: "Transaction resolved",
        category: "DB_OP",
      },
    );
  });

  it("classifies notifications by phase, not by keywords in the text", () => {
    expect(readTracePhase("Notify session trace: Post notification")?.category).toBe(
      "NOTIFICATION",
    );
    expect(
      readTracePhase("Transaction notification trace: not valid signature")?.category,
    ).toBe("NOTIFICATION");
  });

  it("keeps an unknown subject instead of dropping it", () => {
    const parts = readTracePhase("Brand new trace: something happened");
    expect(parts?.phase).toBe("Brand new");
    expect(parts?.category).toBe("BACKEND_LOG");
  });

  it("ignores messages that are not traces", () => {
    expect(readTracePhase("placetopay_event")).toBeNull();
    expect(readTracePhase("Opening 3DS lightbox")).toBeNull();
  });
});

describe("CheckoutMapper · taxonomía de trazas", () => {
  it("exposes phase and step on the event details", () => {
    const event = mapper.map(
      checkoutLog("Session trace: at extra.otpGenerate.response"),
      "",
      0,
    );
    const details = event.details as CheckoutDetails;

    expect(details.phase).toBe("Session");
    expect(details.step).toBe("at extra.otpGenerate.response");
  });

  it("uses the phase for the category instead of guessing from words", () => {
    // «Get session trace: querying external service» no contiene ninguna de las
    // palabras que la heurística anterior buscaba, así que caía en BACKEND_LOG
    // por descarte; ahora la fase lo decide.
    const event = mapper.map(
      checkoutLog("Notify session trace: Executed event"),
      "",
      0,
    );

    expect(event.category).toBe("NOTIFICATION");
  });
});

describe("CheckoutMapper · placetopay_log", () => {
  it("recognises the marker and its event types", () => {
    const data = checkoutLog("placetopay_log", {
      type: "checkout.threeDs.process",
      data: { stage: "mpi_result", openInLightbox: true },
    });

    expect(mapper.canHandle(data)).toBe(true);
    expect(mapper.map(data, "", 0).message).toBe("Event: checkout.threeDs.process");
  });

  it("marks an invalid request as a validation failure", () => {
    const event = mapper.map(
      checkoutLog("placetopay_log", {
        type: "request_not_valid",
        data: { site_id: 6005, errors: [{ field: "payment.amount" }] },
      }),
      "",
      0,
    );

    expect(event.outcome).toMatchObject({
      isError: true,
      kind: "validation",
      status: "REJECTED",
    });
  });
});

describe("CheckoutMapper · statusCode", () => {
  it("leaves the status code null when the log does not carry one", () => {
    const event = mapper.map(checkoutLog("Session trace: whatever"), "", 0);
    // Antes se rellenaba con 200, que se lee como «respondió correctamente».
    expect((event.details as CheckoutDetails).statusCode).toBeNull();
  });

  it("reads the real status code from the gateway response", () => {
    const event = mapper.map(
      checkoutLog("[GW_LIB] HTTP Res", {
        response: { status_code: 502, url: "https://api.example/gateway/process" },
      }),
      "",
      0,
    );

    expect((event.details as CheckoutDetails).statusCode).toBe(502);
  });
});
