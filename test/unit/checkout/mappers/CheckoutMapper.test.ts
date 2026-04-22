import { DEFAULT_CHECKOUT_ACTION_MAP } from "@/checkout/constants/CheckoutActions";
import { CheckoutMapper } from "@/checkout/mappers/CheckoutMapper";
import type { CheckoutDetails, NormalizedLogData } from "@/types";
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

  it("should map requestOtp action to Wallet P2P OTP Generation Request and identify as FRONTEND", () => {
    const logData: NormalizedLogData = {
      timestamp: "2025-12-28T22:17:03.000-05:00",
      level: "INFO",
      message: "Request trace POST /api/v4/session/123/wallet-otp",
      context: { action_method: "requestOtp" },
    };

    const result = mapper.map(logData, "", 1);

    expect(result.message).toBe("Wallet P2P OTP Generation Request");
    expect(result.category).toBe("USER_ACTION");
    expect(result.details.source).toBe("FRONTEND");
  });

  it("should map checkOtp action generically if no wallet string in message", () => {
    const logData: NormalizedLogData = {
      timestamp: "2025-12-28T22:17:03.000-05:00",
      level: "INFO",
      message: "Request trace POST /api/v4/session/123/otp",
      context: { action_method: "checkOtp" },
    };

    const result = mapper.map(logData, "", 1);

    expect(result.message).toBe("OTP validation by user");
    expect(result.category).toBe("USER_ACTION");
  });

  it("should mark generic Request trace messages as FRONTEND source", () => {
    const logData: NormalizedLogData = {
      timestamp: "2025-12-28T22:17:03.000-05:00",
      level: "INFO",
      message: "Request trace GET /api/v4/session/123/information",
      context: {},
    };

    const result = mapper.map(logData, "", 1);

    expect(result.details.source).toBe("FRONTEND");
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

  it("should format opening 3DS dynamically based on openInLightbox flag", () => {
    const logDataFalse: NormalizedLogData = {
      timestamp: "2025-12-28T22:17:03.000-05:00",
      level: "INFO",
      message: "Opening 3DS lightbox",
      context: { openInLightbox: false },
    };

    const logDataTrue: NormalizedLogData = {
      timestamp: "2025-12-28T22:17:03.000-05:00",
      level: "INFO",
      message: "Opening 3DS lightbox",
      context: { openInLightbox: true },
    };

    const resultFalse = mapper.map(logDataFalse, "", 1);
    const resultTrue = mapper.map(logDataTrue, "", 2);

    expect(resultFalse.message).toBe("Opening 3DS (Redirection)");
    expect(resultTrue.message).toBe("Opening 3DS (Lightbox)");
  });

  it("should return a null endpoint for validation errors with no URL", () => {
    const logData: NormalizedLogData = {
      timestamp: "2025-12-28T22:17:03.000-05:00",
      level: "INFO",
      message: "error validation",
      context: {},
    };

    const result = mapper.map(logData, "", 1);
    const details = result.details as CheckoutDetails;

    expect(result.message).toBe("Validation Error (Request)");
    expect(details.endpoint).toBeNull();
  });

  describe("rawTitle and title fields", () => {
    it("should always set rawTitle to the raw message", () => {
      const logData: NormalizedLogData = {
        timestamp: "2025-12-28T22:17:03.000-05:00",
        level: "200",
        message: "Update session state trace: Updating",
        context: {},
      };

      const result = mapper.map(logData, "", 20);
      const details = result.details as CheckoutDetails;

      expect(details.rawTitle).toBe("Update session state trace: Updating");
      expect(details.title).toBe("Update session state trace: Updating");
    });

    it("should set rawTitle but NOT title for Gateway (GW_LIB) messages", () => {
      const logData: NormalizedLogData = {
        timestamp: "2025-12-28T22:17:03.000-05:00",
        level: "200",
        message: "[GW_LIB] HTTP Req",
        context: {
          response: {
            url: "https://api.placetopay.ec/gateway/process",
          },
        },
      };

      const result = mapper.map(logData, "", 21);
      const details = result.details as CheckoutDetails;

      expect(details.rawTitle).toBe("[GW_LIB] HTTP Req");
      expect(details.title).toBeUndefined();
    });

    it("should set rawTitle but NOT title for HTTP Req / HTTP Res messages", () => {
      const logData: NormalizedLogData = {
        timestamp: "2025-12-28T22:17:03.000-05:00",
        level: "200",
        message: "HTTP Req",
        context: {
          request: { url: "https://internal.placetopay.ec/core/tokenize" },
        },
      };

      const result = mapper.map(logData, "", 22);
      const details = result.details as CheckoutDetails;

      expect(details.rawTitle).toBe("HTTP Req");
      expect(details.title).toBeUndefined();
    });

    it("should set rawTitle to undefined when message is empty", () => {
      const logData: NormalizedLogData = {
        timestamp: "2025-12-28T22:17:03.000-05:00",
        level: "200",
        message: "",
        context: {},
      };

      const result = mapper.map(logData, "", 23);
      const details = result.details as CheckoutDetails;

      expect(details.rawTitle).toBeUndefined();
      expect(details.title).toBeUndefined();
    });
  });
});
