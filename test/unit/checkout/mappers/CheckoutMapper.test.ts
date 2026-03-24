import { DEFAULT_CHECKOUT_ACTION_MAP } from "@/checkout/constants/CheckoutActions";
import { CheckoutMapper } from "@/checkout/mappers/CheckoutMapper";
import type { NormalizedLogData } from "@/types";
import { describe, expect, it } from "vitest";

describe("CheckoutMapper", () => {
  const mapper = new CheckoutMapper();

  it("should extract correct displayMessage for Gateway generation", () => {
    const logData: NormalizedLogData = {
      timestamp: "2025-12-28T22:17:03.886969-05:00",
      level: "200",
      message: "[GW_LIB] HTTP Res",
      context: {
        response: {
          url: "https://api.placetopay.ec/gateway/otp/generate",
          body: {
            status: { status: "OK" },
          },
        },
      },
    };

    const result = mapper.map(logData, "", 1);

    expect(result.message).toBe("Gateway: OTP Generation [OK]");
    expect(result.category).toBe("HTTP_RES");
  });

  it("should extract exact validation reason for Gateway OTP validation error", () => {
    const logData: NormalizedLogData = {
      timestamp: "2025-12-28T22:20:32.067427-05:00",
      level: "200",
      message: "[GW_LIB] HTTP Res",
      context: {
        response: {
          url: "https://api.placetopay.ec/gateway/otp/validate",
          body: {
            status: { status: "FAILED", reason: "OT0099" },
          },
        },
      },
    };

    const result = mapper.map(logData, "", 2);

    expect(result.message).toBe("Gateway: OTP Validation [FAILED] (OT0099)");
    expect(result.category).toBe("HTTP_RES");
  });

  it("should infer Db Update category accurately", () => {
    const logData: NormalizedLogData = {
      timestamp: "2025-12-28T22:20:32.073501-05:00",
      level: "200",
      message: "Update session state trace: Updating",
      context: {},
    };

    const result = mapper.map(logData, "", 3);

    expect(result.message).toBe("State Update (Session)");
    expect(result.category).toBe("DB_OP");
  });

  it("should use overridden action when custom actionMap is provided", () => {
    const customMapper = new CheckoutMapper({
      ...DEFAULT_CHECKOUT_ACTION_MAP,
      entry: {
        message: "Custom Entry Override",
        category: "USER_ACTION",
        source: "FRONTEND",
      },
    });

    const logData: NormalizedLogData = {
      timestamp: "2025-12-28T22:17:03.000-05:00",
      level: "200",
      message: "placetopay_event",
      context: { action_method: "entry" },
    };

    const result = customMapper.map(logData, "", 10);

    expect(result.message).toBe("Custom Entry Override");
    expect(result.category).toBe("USER_ACTION");
  });

  it("should resolve a brand-new custom action key", () => {
    const customMapper = new CheckoutMapper({
      ...DEFAULT_CHECKOUT_ACTION_MAP,
      myCustomAction: {
        message: "Integrator Custom Flow",
        category: "HTTP_REQ_IN",
        source: "BACKEND",
      },
    });

    const logData: NormalizedLogData = {
      timestamp: "2025-12-28T22:17:03.000-05:00",
      level: "200",
      message: "placetopay_event",
      context: { action_method: "myCustomAction" },
    };

    const result = customMapper.map(logData, "", 11);

    expect(result.message).toBe("Integrator Custom Flow");
    expect(result.category).toBe("HTTP_REQ_IN");
  });
});
