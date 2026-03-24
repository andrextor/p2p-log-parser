// --- 1. APPLICATION IDENTIFIERS ---

export const AppTypes = {
  CHECKOUT: "checkout",
  MICROSITES: "micrositios",
  REST: "rest",
} as const;

export type AppType = (typeof AppTypes)[keyof typeof AppTypes];

export const AppNames: Record<AppType, string> = {
  [AppTypes.CHECKOUT]: "Checkout",
  [AppTypes.MICROSITES]: "Microsites",
  [AppTypes.REST]: "Core REST API",
};

// --- 2. RAW DATA STRUCTURES (Parsers) ---

export interface NormalizedLogData {
  timestamp: string;
  level: string;
  message: string;
  context: Record<string, unknown>;
  sourceType?:
    | "AWS_CSV"
    | "LARAVEL_LOCAL"
    | "NEW_RELIC_JSON"
    | "GRAFANA_CSV"
    | "UNKNOWN";
}

export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export type LogCategory =
  | "HTTP_REQ_OUT"
  | "HTTP_REQ_IN"
  | "HTTP_RES"
  | "DB_OP"
  | "NOTIFICATION"
  | "RETURN_NOTIFICATION"
  | "BROWSER_LOAD"
  | "USER_ACTION"
  | "BACKEND_LOG"
  | "APPLICATION_LOG"
  | "ERROR"
  | "PAYMENT"
  | "GENERIC";

// --- 3. DOMAIN DETAILS POLYMORPHISM ---

export interface BaseDetails {
  method?: string | null;
  endpoint?: string | null;
  statusCode?: number | string | null;
  payload?: unknown;
  source?: string | null;
  title?: string;
  rawTitle?: string;
}

export interface CheckoutDetails extends BaseDetails {
  url?: string;
  duration?: string;
  sessionId?: string | number;
  transactionId?: string | number;
  subType?: string | null;
  awsRequestId?: string | null;
  provider?: string | null;
}

export interface RestDetails extends BaseDetails {
  provider?: string | null;
  operation?: string | null;
  action?: string | null;
  awsRequestId?: string | null;
  exception?: unknown;
  isLaravel?: boolean;
}

export interface MicrositesDetails extends BaseDetails {
  siteId: string | number;
  formName?: string;
  sessionId?: string | number;
}

export type AppLogDetails = CheckoutDetails | RestDetails | MicrositesDetails;

// --- 4. FINAL EVENT MODEL ---

export interface LogEvent {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  category: LogCategory;
  appType: AppType;
  details: AppLogDetails;
  context: unknown;
  rawStream?: string;
}

export interface SessionFunnelSteps {
  created: number;
  entry: number;
  show: number;
  information: number;
  interest: number;
  generateOtp: number;
  threeDS: number;
  process: number;
}

export interface SessionFunnelRow {
  sessionId: string;
  sessionType: "PAYMENT" | "COLLECT" | "UNKNOWN";
  steps: SessionFunnelSteps;
  _rawTimestamps: {
    created: number | null;
    entry: number | null;
    show: number | null;
  };
  durations: {
    timeToEntry: string | null;
    timeToShow: string | null;
  };
}
