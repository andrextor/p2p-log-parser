import { P2PParserEngine } from "@/engine";
import { AppTypes } from "@/types";
import { buildEventBase } from "@/utils/mapper";
import { normalizeLevel } from "@/utils/parsers";
import { DEFAULT_TZ_OFFSET, fromEpochMs, toEpochMs } from "@/utils/time";
import { describe, expect, it } from "vitest";

describe("fromEpochMs", () => {
  it("renders the epoch in the log offset, not in UTC", () => {
    // El bug: la línea del SDK salía en -05:00 y la de http.log en Z, así que
    // la misma traza mostraba un salto de cinco horas entre request y response.
    expect(fromEpochMs(1787942145554)).toBe("2026-08-28T13:35:45.554-05:00");
    expect(toEpochMs(fromEpochMs(1787942145554))).toBe(1787942145554);
  });

  it("honours a different offset and falls back to UTC when it is unusable", () => {
    expect(fromEpochMs(1787942145554, "+02:00")).toBe(
      "2026-08-28T20:35:45.554+02:00",
    );
    expect(fromEpochMs(1787942145554, "nope")).toBe("2026-08-28T18:35:45.554Z");
  });
});

describe("toEpochMs", () => {
  it("parses ISO timestamps with an explicit offset", () => {
    expect(toEpochMs("2025-12-28T22:14:01.362926-05:00")).toBe(1766978041362);
    expect(toEpochMs("2025-12-28T22:14:01.000Z")).toBe(1766960041000);
  });

  it("accepts offsets shortened to hours, which Date.parse rejects", () => {
    // Date.parse("2025-12-28T22:14:01.362-05") === NaN
    expect(toEpochMs("2025-12-28T22:14:01.362-05")).toBe(1766978041362);
  });

  it("pins naive timestamps to the default offset instead of machine time", () => {
    // Sin esto el resultado dependía de la zona horaria de la máquina/CI.
    expect(toEpochMs("2025-12-28 22:14:01")).toBe(
      Date.parse(`2025-12-28T22:14:01${DEFAULT_TZ_OFFSET}`),
    );
    expect(toEpochMs("2025-12-28 22:14:01", "+00:00")).toBe(
      Date.parse("2025-12-28T22:14:01Z"),
    );
  });

  it("returns NaN for values it cannot interpret", () => {
    expect(toEpochMs("garbage")).toBeNaN();
    expect(toEpochMs("")).toBeNaN();
    expect(toEpochMs(null)).toBeNaN();
  });
});

describe("normalizeLevel", () => {
  it("maps numeric Monolog levels by range", () => {
    expect(normalizeLevel({ level: 100 })).toBe("DEBUG");
    expect(normalizeLevel({ level: 200 })).toBe("INFO");
    expect(normalizeLevel({ level: 250 })).toBe("INFO"); // NOTICE
    expect(normalizeLevel({ level: 300 })).toBe("WARNING");
    expect(normalizeLevel({ level: 400 })).toBe("ERROR");
    expect(normalizeLevel({ level: 500 })).toBe("CRITICAL");
    expect(normalizeLevel({ level: 600 })).toBe("CRITICAL"); // EMERGENCY
  });

  it("handles intermediate levels an exact lookup table would miss", () => {
    expect(normalizeLevel({ level: 450 })).toBe("ERROR");
    expect(normalizeLevel({ level: 275 })).toBe("INFO");
    expect(normalizeLevel({ level: 550 })).toBe("CRITICAL");
  });

  it("prefers level_name and collapses PSR-3 aliases", () => {
    expect(normalizeLevel({ level_name: "ERROR", level: 200 })).toBe("ERROR");
    expect(normalizeLevel({ level_name: "notice" })).toBe("INFO");
    expect(normalizeLevel({ level_name: "EMERGENCY" })).toBe("CRITICAL");
  });

  it("falls back to the default on unknown values", () => {
    expect(normalizeLevel({ level_name: "???" })).toBe("INFO");
    expect(normalizeLevel({}, "DEBUG")).toBe("DEBUG");
  });
});

describe("buildEventBase", () => {
  it("derives the id from content, not from the line position", () => {
    const ctx = { aws_request_id: "abc-123" };
    const a = buildEventBase(ctx, "2025-12-28T22:14:01-05:00", "same message");
    const b = buildEventBase(ctx, "2025-12-28T22:14:01-05:00", "same message");
    const other = buildEventBase(ctx, "2025-12-28T22:14:01-05:00", "different");

    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(other.id);
  });

  it("keeps ids stable across exports that trim leading lines", () => {
    const line = `2025-12-28 22:14:01,x,y,"{""message"":""placetopay_event"",""context"":{""aws_request_id"":""r-1"",""session_id"":9},""level"":200,""datetime"":""2025-12-28T22:14:01.362-05:00""}",9,view`;
    const noise = `2025-12-28 22:13:00,x,y,"{""message"":""placetopay_event"",""context"":{""aws_request_id"":""r-0"",""session_id"":8},""level"":200,""datetime"":""2025-12-28T22:13:00.000-05:00""}",8,view`;

    const engine = new P2PParserEngine();
    const first = engine.parse(line, AppTypes.CHECKOUT);
    const second = engine.parse(`${noise}\n${line}`, AppTypes.CHECKOUT);

    const target = second.events.find((e) => e.correlation.traceId === "r-1");
    expect(first.events[0].id).toBe(target?.id);
  });

  it("exposes correlation identifiers resolved from the context", () => {
    const { correlation } = buildEventBase(
      {
        aws_request_id: "r-9",
        session_id: 64495486,
        TENANT_DOMAIN: "checkout.placetopay.ec",
        data: { site_id: 6005 },
        body: { auth: { login: "abc" }, payment: { reference: "REF-1" } },
      },
      "2025-12-28T22:14:01-05:00",
      "msg",
      { tenantId: 100 },
    );

    expect(correlation).toEqual({
      traceId: "r-9",
      sessionId: "64495486",
      tenant: "checkout.placetopay.ec",
      siteId: "6005",
      login: "abc",
      reference: "REF-1",
      tenantId: "100",
    });
  });
});
