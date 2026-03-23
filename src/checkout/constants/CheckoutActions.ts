import { LogCategory } from "@/types";

export interface CheckoutActionDetail {
  message: string;
  category: LogCategory;
  source: "FRONTEND" | "BACKEND";
}

export const CheckoutActionMap: Record<string, CheckoutActionDetail> = {
  // --- SPA / Browser Flows ---
  entry: {
    message: "Browser interface visualization (SPA)",
    category: "BROWSER_LOAD",
    source: "FRONTEND",
  },
  show: {
    message: "Session successfully loaded in SPA",
    category: "BROWSER_LOAD",
    source: "FRONTEND",
  },
  index: {
    message: "Payment methods view",
    category: "BROWSER_LOAD",
    source: "FRONTEND",
  },
  state: {
    message: "Session result view",
    category: "BROWSER_LOAD",
    source: "FRONTEND",
  },
  process: {
    message: "User action: Process Payment",
    category: "USER_ACTION",
    source: "FRONTEND",
  },
  checkOtp: {
    message: "OTP validation by user",
    category: "USER_ACTION",
    source: "FRONTEND",
  },

  // --- Backend / API Flows ---
  "checkout.session.created": {
    message: "Session creation request: Flow initialization",
    category: "HTTP_REQ_IN",
    source: "BACKEND",
  },
  createSession: {
    message: "Session Creation (API Backend)",
    category: "HTTP_REQ_IN",
    source: "BACKEND",
  },
  sessionInformation: {
    message: "Session information request (Public API)",
    category: "HTTP_REQ_IN",
    source: "BACKEND",
  },
  interest: {
    message: "Installments and Interests Calculation",
    category: "HTTP_REQ_IN",
    source: "BACKEND",
  },

  // --- External Notifications & Callbacks ---
  transaction: {
    message: "Transaction notification: Payment status update",
    category: "RETURN_NOTIFICATION",
    source: "BACKEND",
  },
  "App\\Http\\Controllers\\Api\\V4\\ReturnController": {
    message: "Gateway Return (3DS / Redirection)",
    category: "RETURN_NOTIFICATION",
    source: "BACKEND",
  },
  "App\\Http\\Controllers\\Api\\V4\\BanksDataController": {
    message: "Bank list request",
    category: "HTTP_REQ_IN",
    source: "BACKEND",
  },

  // --- Future / Edge Cases Approximations ---
  "checkout.session.updated": {
    message: "Session update request",
    category: "HTTP_REQ_IN",
    source: "BACKEND",
  },
  "checkout.session.expired": {
    message: "Session expired state recorded",
    category: "BACKEND_LOG",
    source: "BACKEND",
  },
};
