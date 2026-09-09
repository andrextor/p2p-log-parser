import * as fs from "node:fs";
import * as path from "node:path";
import { P2PParserEngine } from "@/engine";
import { AppTypes, type RestDetails } from "@/types";
import { describe, expect, it } from "vitest";

/**
 * Fixture derivado de un export real de New Relic Logs de la API REST
 * (anonimizado: credenciales, IPs, referencias y nombres de comercio
 * sustituidos; la forma del registro se conserva intacta).
 */
describe("New Relic CSV export (REST, end to end)", () => {
  const csv = fs.readFileSync(
    path.resolve(__dirname, "../../fixtures/rest-newrelic.csv"),
    "utf-8",
  );

  const result = new P2PParserEngine().parse(csv, AppTypes.REST);
  const byMessage = (needle: string) =>
    result.events.find((e) => e.message.includes(needle));

  it("parses every row of the export", () => {
    // Antes de la estrategia CSV este mismo export producía 0 eventos.
    expect(result.events).toHaveLength(6);
    expect(result.errors).toHaveLength(0);
    expect(result.events.every((e) => e.appType === AppTypes.REST)).toBe(true);
  });

  it("reads the SDK exchange from the Atropos context", () => {
    const request = byMessage("Transaction Authorization | REQUEST DECRYPTED");
    const details = request?.details as RestDetails;

    expect(request?.category).toBe("HTTP_REQ_OUT");
    expect(details.provider).toBe("INTERDIN");
    expect(details.operation).toBe("sale");
    expect(details.action).toBe("request-decrypted");
    expect(details.method).toBe("POST");
    expect(details.endpoint).toBe("placetopay/test/consumos/pos/autorizar");
    expect(details.simulator).toBeUndefined();
    expect(request?.correlation.traceId).toBe("1111111111111111111111111111aaaa");
  });

  it("flags a declined transaction reported with Spanish dinError keys", () => {
    // El proveedor emite `codigo`/`mensaje`, no `code`/`message`: buscar solo
    // las claves en inglés dejaba pasar la negación como respuesta correcta.
    const declined = byMessage("Error 88");

    expect(declined?.category).toBe("ERROR");
    expect(declined?.level).toBe("ERROR");
    expect(declined?.message).toBe("INTERDIN | Error 88: Transacción negada");
    expect((declined?.details as RestDetails).statusCode).toBe("88");
  });

  it("does not treat dinError code 0000 as a failure", () => {
    const ok = byMessage("Transaction Query | RESPONSE DECRYPTED");

    expect(ok?.category).toBe("HTTP_RES");
    expect(ok?.level).toBe("INFO");
  });

  it("extracts the inbound API request, its status and its identifiers", () => {
    const collect = byMessage("/gateway/collect");
    const details = collect?.details as RestDetails;

    expect(collect?.category).toBe("HTTP_REQ_IN");
    expect(details.statusCode).toBe(200);
    expect(collect?.correlation.login).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(collect?.correlation.reference).toBe("SC-000000T-TEST001");
    expect(collect?.correlation.internalReference).toBe("900000001");
  });

  it("marks a 4xx inbound response as an error", () => {
    const reverse = byMessage("/gateway/transaction");

    expect(reverse?.category).toBe("ERROR");
    expect((reverse?.details as RestDetails).statusCode).toBe(400);
  });

  it("maps ALERT to CRITICAL and keeps the application log readable", () => {
    const alert = byMessage("Trying to resolve non pending session");

    expect(alert?.level).toBe("CRITICAL");
    expect(alert?.category).toBe("APPLICATION_LOG");
  });

  it("orders events chronologically across log files", () => {
    const stamps = result.events.map((e) => e.ts);
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    expect(stamps.every((t) => Number.isFinite(t))).toBe(true);
  });
});
