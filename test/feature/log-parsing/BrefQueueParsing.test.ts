import * as fs from "node:fs";
import * as path from "node:path";
import type { CheckoutParseMetadata } from "@/engine";
import { P2PParserEngine } from "@/engine";
import { AppTypes } from "@/types";
import { describe, expect, it } from "vitest";

/**
 * Export de Grafana de un Checkout desplegado con Bref (no Vapor): la columna
 * `@message` trae `LEVEL\tmensaje\t{json}`, sin `datetime`, `TENANT_DOMAIN` ni
 * `aws_request_id`, y la hora del CSV viene sin fracción. Recorte real de un
 * job de cola que resolvió la transacción 334 de la sesión 755, más el 403 del
 * gateway y el ruido START/END/REPORT del lambda.
 */
const parse = () => {
  const csv = fs.readFileSync(
    path.resolve(__dirname, "../../fixtures/checkout-bref-queue.csv"),
    "utf-8",
  );
  return new P2PParserEngine().parse(csv, AppTypes.CHECKOUT);
};

describe("export de Grafana con formato Bref", () => {
  it("lee el JSON detrás del prefijo LEVEL\\tmensaje\\t", () => {
    const { events, stats, errors } = parse();
    expect(errors).toHaveLength(0);
    expect(events.length).toBeGreaterThanOrEqual(15);
    expect(events.every((e) => e.appType === AppTypes.CHECKOUT)).toBe(true);
    expect(stats.byLevel.INFO).toBeGreaterThan(0);
    expect(stats.byLevel.DEBUG).toBeGreaterThan(0);
  });

  it("la hora sale de la columna Time con el offset por defecto", () => {
    const first = parse().events[0];
    expect(first.timestamp).toBe("2026-09-14 10:16:41");
    expect(first.ts).toBe(Date.parse("2026-09-14T10:16:41-05:00"));
  });

  it("dentro del mismo segundo conserva el orden del fichero", () => {
    const titles = parse().events.map((e) => e.details.rawTitle ?? "");
    const start = titles.findIndex((t) => t.includes("Start Updating"));
    const resolved = titles.findIndex((t) => t.includes("Transaction resolved"));
    const sessionUpdate = titles.findIndex((t) =>
      t.includes("Update session state trace: Updating"),
    );
    expect(start).toBeLessThan(resolved);
    expect(resolved).toBeLessThan(sessionUpdate);
  });

  it("la sesión 755 acaba APPROVED aunque todo caiga en el mismo segundo", () => {
    const meta = parse().metadata as CheckoutParseMetadata;
    const session = meta.sessions.find((s) => s.sessionId === "755");
    expect(session?.transactionStatus).toBe("APPROVED");
    expect(session?.finalState).toBe("FINISHED");
    // El recorte empieza después de /process: la transacción decide igual.
    expect(session?.steps.process).toBe(false);
    expect(session?.outcome).toBe("APPROVED");
  });

  it("etiqueta las consultas al gateway", () => {
    const { events } = parse();
    const search = events.filter((e) =>
      e.details.endpoint?.endsWith("/gateway/search"),
    );
    expect(search.map((e) => e.message)).toEqual([
      "Gateway: Transaction Search",
      "Gateway: Transaction Search [OK]",
    ]);
  });

  it("un 403 del gateway es un fallo, y la excepción CRITICAL también", () => {
    const { events, stats } = parse();
    const forbidden = events.find((e) => e.details.statusCode === 403);
    expect(forbidden?.outcome).toMatchObject({ isError: true, kind: "http", httpStatus: 403 });

    const exception = events.find((e) => e.category === "ERROR");
    expect(exception?.level).toBe("ERROR");
    expect(exception?.outcome?.kind).toBe("exception");
    expect(exception?.outcome?.code).toBe("403");
    expect(stats.errorCount).toBe(2);
  });

  it("el ruido del lambda (START/END/REPORT) no produce eventos ni errores", () => {
    const { stats, errors } = parse();
    expect(errors).toHaveLength(0);
    expect(stats.unrecognized).toBeGreaterThan(0);
  });
});
