import * as fs from "node:fs";
import * as path from "node:path";
import { P2PParserEngine } from "@/engine";
import { AppTypes } from "@/types";
import { matchEvent } from "@/utils/match";
import { describe, expect, it } from "vitest";

describe("matchEvent", () => {
  const csv = fs.readFileSync(
    path.resolve(__dirname, "../../fixtures/rest-newrelic.csv"),
    "utf-8",
  );
  const result = new P2PParserEngine().parse(csv, AppTypes.REST);
  const find = (id: string) => result.events.filter((e) => matchEvent(e, id));

  it("follows a provider trace across its request and response", () => {
    expect(find("1111111111111111111111111111aaaa")).toHaveLength(4);
  });

  it("matches by any correlation identifier, not just the trace", () => {
    expect(find("SC-000000T-TEST001")).toHaveLength(1); // reference
    expect(find("900000001").length).toBeGreaterThan(0); // internalReference
    expect(find("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toHaveLength(2); // login
  });

  it("is case insensitive and tolerates surrounding spaces", () => {
    expect(find("  SC-000000t-TEST001  ")).toHaveLength(1);
  });

  it("matches an event by its own id", () => {
    const event = result.events[0];
    expect(matchEvent(event, event.id)).toBe(true);
  });

  it("does not match an unrelated value", () => {
    expect(find("nope")).toHaveLength(0);
    expect(matchEvent(result.events[0], "")).toBe(false);
  });
});

describe("ParseResult.stats", () => {
  const csv = fs.readFileSync(
    path.resolve(__dirname, "../../fixtures/rest-newrelic.csv"),
    "utf-8",
  );
  const { stats } = new P2PParserEngine().parse(csv, AppTypes.REST);

  it("summarises the batch without walking the events again", () => {
    expect(stats.total).toBe(7);
    expect(stats.byApp[AppTypes.REST]).toBe(7);
    expect(stats.errorCount).toBe(2); // el rechazo del proveedor y el 400
    expect(stats.byLevel.CRITICAL).toBe(1);
    // La fila de cabecera del CSV no produce evento y cuenta como tal.
    expect(stats.unrecognized).toBe(1);
  });

  it("reports the window the export covers", () => {
    expect(stats.timespan?.ms).toBe(9382); // 13:35:41.094 → 13:35:50.476
  });

  it("counts text no strategy recognised", () => {
    const result = new P2PParserEngine().parse(
      "esto no es un log\ntampoco esto",
      AppTypes.REST,
    );
    expect(result.stats.unrecognized).toBe(2);
    expect(result.stats.total).toBe(0);
  });
});
