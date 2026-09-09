import { P2PParserEngine } from "@/engine";
import { RestMapper } from "@/rest/mappers/RestMapper";
import { RestNewRelicParser } from "@/rest/strategies/RestNewRelicParser";
import { AppTypes, type NormalizedLogData, type RestDetails } from "@/types";
import { describe, expect, it } from "vitest";

const mapper = new RestMapper();

/** Registro tal y como lo emite Atropos/Tangram (HttpLoggerListener). */
function atropos(
  action: string,
  extra: Record<string, unknown> = {},
): NormalizedLogData {
  return {
    timestamp: "2026-03-31T01:39:17.439379-05:00",
    level: "INFO",
    message: `INTERDIN ${action.toUpperCase()} 8f3c1d`,
    context: {
      id: "8f3c1d",
      provider: "INTERDIN",
      action,
      operation: "createOTP",
      simulatorMode: false,
      context: {
        method: "POST",
        endpoint: "https://interdin.example/otp/generate",
        ...extra,
      },
    },
    sourceType: "NEW_RELIC_JSON",
  };
}

describe("RestMapper · formato Atropos (SDK de proveedor)", () => {
  it("reads provider, operation, action, method and endpoint from context", () => {
    const event = mapper.map(atropos("request", { data: { bin: "455613" } }), "", 0);
    const details = event.details as RestDetails;

    expect(details.provider).toBe("INTERDIN");
    expect(details.operation).toBe("createOTP");
    expect(details.action).toBe("request");
    expect(details.method).toBe("POST");
    expect(details.endpoint).toBe("https://interdin.example/otp/generate");
    expect(details.transport).toBe("http");
    expect(details.requestBody).toEqual({ bin: "455613" });
    expect(event.category).toBe("HTTP_REQ_OUT");
    expect(event.message).toBe("Second Factor Request (OTP) | REQUEST");
    expect(event.correlation.traceId).toBe("8f3c1d");
  });

  it("treats the decrypted variants as the same exchange", () => {
    expect(mapper.map(atropos("request-decrypted"), "", 0).category).toBe(
      "HTTP_REQ_OUT",
    );
    expect(mapper.map(atropos("response-decrypted"), "", 0).category).toBe(
      "HTTP_RES",
    );
  });

  it("promotes a WARNING with an exception to ERROR", () => {
    // Los listeners de Tangram registran los fallos con `warning`, no `error`:
    // sin esta promoción los fallos de proveedor no se veían como error.
    const data = atropos("response", {
      exception: {
        class: "GuzzleHttp/Exception/ConnectException",
        message: "cURL error 28: Operation timed out",
        file: "/app/vendor/guzzle/Handler.php",
        line: 211,
      },
    });
    data.level = "WARNING";

    const event = mapper.map(data, "", 0);
    const details = event.details as RestDetails;

    expect(event.level).toBe("ERROR");
    expect(event.category).toBe("ERROR");
    expect(details.exception?.line).toBe(211);
    expect(details.exception?.class).toBe("GuzzleHttp/Exception/ConnectException");
  });
});

describe("RestMapper · formato guzzle-logger", () => {
  it("takes the real status code instead of assuming 200", () => {
    const event = mapper.map(
      {
        timestamp: "2026-03-31T01:39:18-05:00",
        level: "INFO",
        message: "HTTP Res",
        context: {
          provider: "CREDIBANCO",
          response: {
            url: "https://credibanco.example/process",
            status_code: 502,
            body: { detail: "bad gateway" },
          },
        },
        sourceType: "NEW_RELIC_JSON",
      },
      "",
      0,
    );

    const details = event.details as RestDetails;
    expect(details.statusCode).toBe(502);
    expect(event.category).toBe("ERROR"); // >= 400 deja de venderse como éxito
    expect(details.responseBody).toEqual({ detail: "bad gateway" });
  });

  it("leaves statusCode null when the log does not carry one", () => {
    const event = mapper.map(atropos("response"), "", 0);
    expect((event.details as RestDetails).statusCode).toBeNull();
  });
});

describe("RestMapper · log HTTP entrante (canal http)", () => {
  it("extracts the inbound request, its status and its identifiers", () => {
    const engine = new P2PParserEngine();
    const payload = JSON.stringify({
      method: "POST",
      uri: "/gateway/process",
      ip: "10.0.0.4",
      login: "vz3gNGDF8UKbfuRPA4u1tLes8KQqR59Z",
      action: "process",
      responseStatusCode: 200,
      headers: { userAgent: "RestSharp", sourcePlatform: null },
      bodyRequest: { internalReference: 998877, reference: "REF-42" },
      bodyResponse: { internalReference: 998877 },
    });

    const result = engine.parse(
      `[2026-03-31 01:39:17] http.INFO: ${payload}`,
      AppTypes.REST,
    );

    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    const details = event.details as RestDetails;

    expect(event.appType).toBe(AppTypes.REST);
    expect(event.category).toBe("HTTP_REQ_IN");
    expect(event.message).toBe("API POST /gateway/process");
    expect(details.statusCode).toBe(200);
    expect(details.channel).toBe("http");
    expect(event.correlation.login).toBe("vz3gNGDF8UKbfuRPA4u1tLes8KQqR59Z");
    expect(event.correlation.internalReference).toBe("998877");
    expect(event.correlation.reference).toBe("REF-42");
  });
});

describe("RestMapper · canal Monolog como proveedor", () => {
  it("infers the provider from the channel when the context lacks one", () => {
    const engine = new P2PParserEngine();
    const result = engine.parse(
      '[2026-03-31 01:39:17] interdin.INFO: Sending SMS {"reference":"REF-9"}',
      AppTypes.REST,
    );

    const details = result.events[0].details as RestDetails;
    expect(result.events[0].appType).toBe(AppTypes.REST);
    expect(details.provider).toBe("INTERDIN");
    // El fragmento conocido ahora sí se traduce (antes el mapa era código muerto).
    expect(result.events[0].message).toBe("SMS Messaging Management");
    expect(result.events[0].category).toBe("NOTIFICATION");
  });
});

describe("RestNewRelicParser · detección", () => {
  const parser = new RestNewRelicParser();

  it("accepts structured log records", () => {
    expect(
      parser.parse('{"message":"INTERDIN REQUEST 1","context":{},"level":200}'),
    ).not.toBeNull();
    expect(
      parser.parse('{"provider":"INTERDIN","action":"request","operation":"sale"}'),
    ).not.toBeNull();
  });

  it("rejects arbitrary JSON that is not a log record", () => {
    // Antes tragaba cualquier objeto `{…}` y se apropiaba de líneas ajenas.
    expect(parser.parse('{"foo":"bar"}')).toBeNull();
    expect(parser.parse('{"total":3,"items":[]}')).toBeNull();
    expect(parser.parse("not json")).toBeNull();
  });

  it("does not invent a timestamp when the record has none", () => {
    const result = parser.parse('{"message":"x","context":{},"level":200}');
    expect(result?.timestamp).toBe("");
  });
});
