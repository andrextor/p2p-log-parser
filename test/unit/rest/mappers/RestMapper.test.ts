import { DEFAULT_REST_ACTION_MAP } from "@/rest/constants/RestActions";
import { RestMapper } from "@/rest/mappers/RestMapper";
import type { LogCategory, NormalizedLogData, RestDetails } from "@/types";
import { describe, expect, it } from "vitest";

describe("RestMapper Unit Tests", () => {
  const mapper = new RestMapper();

  it("should identify new relic JSON as valid handle", () => {
    const data: NormalizedLogData = {
      timestamp: "2025-12-28",
      level: "INFO",
      message: "Random log",
      context: {},
      sourceType: "NEW_RELIC_JSON",
    };
    expect(mapper.canHandle(data)).toBe(true);
  });

  it("should identify laravel logs containing relevant patterns", () => {
    const data: NormalizedLogData = {
      timestamp: "2025-12-28",
      level: "INFO",
      message: "[2025-12-28 10:00:00] production.INFO: Hello World",
      context: {},
    };
    expect(mapper.canHandle(data)).toBe(true);
  });

  it("should parse internal truncated JSON appropriately and extract provider", () => {
    const data: NormalizedLogData = {
      timestamp: "2025-12-28",
      level: "INFO",
      message: 'Req Event {"provider":"TEST_PROVIDER","action":"request"', // artificially truncated
      context: {},
    };

    // Internal parser will try to fix the missing bracket
    const result = mapper.map(data, "", 1);
    const details = result.details as RestDetails;

    expect(details.provider).toBe("TEST_PROVIDER");
    expect(result.category).toBe("HTTP_REQ_OUT");
    expect(result.message).toContain("API Operation | REQUEST");
  });

  it("should translate dictionary actions accurately", () => {
    const data: NormalizedLogData = {
      timestamp: "2025-12-28",
      level: "INFO",
      message: '{"operation":"authorize","action":"request"}',
      context: {},
    };

    const result = mapper.map(data, "", 1);

    // Translation assert checking constants
    expect(result.message).toContain("Transaction Authorization");
  });

  it("should set an explicit critical error reason", () => {
    const data: NormalizedLogData = {
      timestamp: "2025-12-28",
      level: "ERROR",
      message: '{"operation":"authorize"}',
      context: {
        exception: { message: "`503` Service Unavailable" },
      },
    };

    const result = mapper.map(data, "", 1);
    const details = result.details as RestDetails;

    expect(result.category).toBe("ERROR" as LogCategory);
    expect(result.message).toContain("Critical Failure [API_REST]");
    expect(details.statusCode).toBe("503");
  });

  it("should use overridden action when custom actionMap is provided", () => {
    const customMapper = new RestMapper({
      ...DEFAULT_REST_ACTION_MAP,
      authorize: {
        message: "Custom Authorization Flow",
        category: "PAYMENT",
        source: "BACKEND",
      },
    });

    const data: NormalizedLogData = {
      timestamp: "2025-12-28",
      level: "INFO",
      message: '{"operation":"authorize","action":"request"}',
      context: {},
    };

    const result = customMapper.map(data, "", 1);

    expect(result.message).toContain("Custom Authorization Flow");
  });

  it("should resolve a brand-new custom REST action key", () => {
    const customMapper = new RestMapper({
      ...DEFAULT_REST_ACTION_MAP,
      refund: {
        message: "Refund Operation",
        category: "PAYMENT",
        source: "BACKEND",
      },
    });

    const data: NormalizedLogData = {
      timestamp: "2025-12-28",
      level: "INFO",
      message: '{"operation":"refund","action":"request"}',
      context: {},
    };

    const result = customMapper.map(data, "", 2);

    expect(result.message).toContain("Refund Operation");
    expect(result.category).toBe("HTTP_REQ_OUT");
  });
});
