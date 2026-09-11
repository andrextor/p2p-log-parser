import { resolveOutcome } from "@/common/outcome";
import { describe, expect, it } from "vitest";

describe("resolveOutcome", () => {
  it("treats dinError code 0000 as success", () => {
    const outcome = resolveOutcome({
      context: {},
      payload: {
        context: { data: { dinError: { codigo: "0000", mensaje: "OK" } } },
      },
    });

    expect(outcome.isError).toBe(false);
    expect(outcome.status).toBe("OK");
  });

  it("reports a provider rejection with the Spanish dinError keys", () => {
    const outcome = resolveOutcome({
      context: {},
      payload: {
        context: {
          data: {
            dinError: {
              codigo: "0056",
              mensaje: "Transacción negada",
              detalle: "Fondos insuficientes",
            },
          },
        },
      },
    });

    expect(outcome).toMatchObject({
      isError: true,
      status: "REJECTED",
      kind: "business",
      code: "0056",
      message: "Transacción negada",
    });
  });

  it("keeps the four fields of a transport exception", () => {
    const outcome = resolveOutcome({
      context: {
        exception: {
          class: "GuzzleHttp/Exception/ConnectException",
          message: "`503` Service Unavailable",
          file: "/app/Handler.php",
          line: 211,
        },
      },
    });

    expect(outcome.kind).toBe("exception");
    expect(outcome.status).toBe("FAILED");
    expect(outcome.code).toBe("503"); // extraído del texto
    expect(outcome.exception).toEqual({
      class: "GuzzleHttp/Exception/ConnectException",
      message: "`503` Service Unavailable",
      file: "/app/Handler.php",
      line: 211,
    });
  });

  it("classifies a validation failure ahead of the exception that carries it", () => {
    // La excepción *es* la validación; `validation` es la clasificación precisa.
    const outcome = resolveOutcome({
      context: { exception: { reason: "request_not_valid" } },
      subType: "request_not_valid",
    });

    expect(outcome.kind).toBe("validation");
    expect(outcome.status).toBe("REJECTED");
  });

  it("falls back to the HTTP status when nothing else explains the failure", () => {
    expect(resolveOutcome({ context: {}, statusCode: 400 })).toMatchObject({
      isError: true,
      kind: "http",
      httpStatus: 400,
      code: "400",
      message: "HTTP 400",
    });
    expect(resolveOutcome({ context: {}, statusCode: 200 })).toMatchObject({
      isError: false,
      status: "OK",
    });
  });

  it("an APPROVED gateway status is not a rejection", () => {
    // La respuesta real de /rest/gateway/process de un pago aprobado.
    for (const status of ["APPROVED", "PENDING", "APPROVED_PARTIAL"]) {
      expect(
        resolveOutcome({
          context: {},
          statusCode: 200,
          payload: {
            response: { body: { status: { status, reason: "00", message: "Approved" } } },
          },
        }),
      ).toMatchObject({ isError: false, status: "OK" });
    }
  });

  it("reads the gateway status block used by Checkout", () => {
    const outcome = resolveOutcome({
      context: {},
      payload: {
        response: {
          body: { status: { status: "FAILED", reason: "OT02", message: "Invalid OTP" } },
        },
      },
    });

    expect(outcome).toMatchObject({
      isError: true,
      kind: "business",
      code: "OT02",
      message: "Invalid OTP",
    });
  });

  it("says nothing failed when there is no signal at all", () => {
    expect(resolveOutcome({ context: {} })).toEqual({
      isError: false,
      status: "OK",
      httpStatus: undefined,
    });
  });
});
