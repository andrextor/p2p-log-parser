import { LogCategory } from "@/types";

export interface RestActionDetail {
  message: string;
  category: LogCategory;
  source: "BACKEND";
}

export const REST_ACTION_MAP: Record<string, RestActionDetail> = {
  // --- SDK / API Operations ---
  creditType: {
    message: "Bin and Installment Query",
    category: "HTTP_REQ_OUT",
    source: "BACKEND",
  },
  createOTP: {
    message: "Second Factor Request (OTP)",
    category: "NOTIFICATION",
    source: "BACKEND",
  },
  authorize: {
    message: "Transaction Authorization",
    category: "PAYMENT",
    source: "BACKEND",
  },
  // --- Laravel.log Events (Keyword Detection) ---
  "no bin information": {
    message: "BIN information not found",
    category: "BACKEND_LOG",
    source: "BACKEND",
  },
  "Error resolving credit types": {
    message: "Failed resolving credit types",
    category: "ERROR",
    source: "BACKEND",
  },
  "Sending SMS": {
    message: "SMS Messaging Management",
    category: "NOTIFICATION",
    source: "BACKEND",
  },
  "loading invoices": {
    message: "Invoice Processing",
    category: "BACKEND_LOG",
    source: "BACKEND",
  },
};
