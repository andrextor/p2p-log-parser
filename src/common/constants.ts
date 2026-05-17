export const RAW_STREAM_MAX_LENGTH = 200;

export const MARKER = {
  GATEWAY: "[GW_LIB]",
  PLACETOPAY_EVENT: "placetopay_event",
  REQUEST_TRACE: "Request trace",
  SESSION_CREATED: "checkout.session.created",
  SESSION_ENTRY: "checkout.session.entry",
} as const;

export const GATEWAY_PATH_LABELS: Record<
  string,
  { label: string; showReason?: boolean }
> = {
  "/otp/generate": { label: "Gateway: OTP Generation" },
  "/otp/validate": {
    label: "Gateway: OTP Validation",
    showReason: true,
  },
  "/mpi/lookup": { label: "Gateway: 3DS Lookup (MPI)" },
  "/process": {
    label: "Gateway: Process Payment",
    showReason: true,
  },
  "/collect": { label: "Gateway: Collect", showReason: true },
  "/information": { label: "Gateway: Instrument Information" },
  "/interests": {
    label: "Gateway: Interest Calculation",
    showReason: true,
  },
};
