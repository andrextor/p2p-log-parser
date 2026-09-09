/**
 * Catálogo de operaciones de los SDK de proveedor.
 *
 * Las claves salen de `PlacetoPay\Base\Constants\Operations` y de las clases
 * `AdditionalOperations` de cada SDK en `rest-services/vendor/placetopay/*`.
 * Son el valor literal que viaja en `context.operation` de los logs Atropos.
 */
export const REST_OPERATION_LABELS: Record<string, string> = {
  // --- Operations.php (base, comunes a todos los SDK) ---
  sale: "Transaction Authorization",
  refund: "Refund",
  annulment: "Annulment",
  reverse: "Reversal",
  checkin: "Pre-authorization (Check-in)",
  checkout: "Pre-authorization Settlement (Check-out)",
  reauthorization: "Reauthorization",
  echoTest: "Connectivity Test",
  createOTP: "Second Factor Request (OTP)",
  validateOTP: "Second Factor Validation (OTP)",
  query: "Transaction Query",
  authentication: "Authentication",

  // --- AdditionalOperations por SDK ---
  accountValidation: "Account Validation",
  authorize: "Transaction Authorization",
  bankList: "Bank List Query",
  batchUpload: "Batch Upload",
  calculateInterest: "Interest Calculation",
  calculateInterests: "Interest Calculation",
  chargebackOrder: "Chargeback Order",
  close: "Batch Close",
  confirmation: "Payment Confirmation",
  createOrder: "Order Creation",
  creditInstallments: "Credit Installments Query",
  creditType: "Bin and Installment Query",
  deleteToken: "Token Deletion",
  dispersion: "Funds Dispersion",
  enrollCard: "Card Enrollment",
  finalize: "Transaction Finalization",
  financingPlans: "Financing Plans Query",
  getCryptogram: "Cryptogram Request",
  getOrder: "Order Query",
  getTokenStatus: "Token Status Query",
  historical: "Historical Query",
  inquiryOrder: "Order Inquiry",
  latest: "Latest Records Query",
  lookup: "3DS Lookup (MPI)",
  makeSession: "Session Creation",
  multi_credit: "Multi-credit Query",
  payment: "Payment",
  points: "Loyalty Points Query",
  queryPayment: "Payment Query",
  registration: "Registration",
  settlement: "Settlement",
  store_user: "User Registration",
  sync_user: "User Synchronization",
  update: "Update",
  updateMerchant: "Merchant Update",
  updateOrder: "Order Update",
  validate: "Validation",
};

/**
 * Canal Monolog → proveedor. `config/logging.php` de rest-services dedica un
 * canal por integración, así que el canal identifica al proveedor cuando el
 * contexto del log no trae `provider`.
 */
export const CHANNEL_PROVIDERS: Record<string, string> = {
  credibanco: "CREDIBANCO",
  interdin: "INTERDIN",
  interdin_conciliation: "INTERDIN",
  datafast: "DATAFAST",
  redeban: "REDEBAN",
  bancolombia: "BANCOLOMBIA",
  aval: "AVAL",
  dilo: "DILO",
  autopay: "AUTOPAY",
  subscriptions: "SUBSCRIPTIONS",
  notification: "NOTIFICATION",
  push_notification: "MSV",
  ebus_pga: "EBUS",
  ebus_ach_returns: "EBUS",
  iva_managers: "IVA_MANAGERS",
};

/** Acciones Atropos que representan la ida de un intercambio. */
const REQUEST_ACTIONS = new Set([
  "request",
  "request-decrypt",
  "request-decrypted",
]);

export function isRequestAction(action: string): boolean {
  return REQUEST_ACTIONS.has(action.toLowerCase());
}

export function describeOperation(operation: string): string {
  return REST_OPERATION_LABELS[operation] ?? operation;
}
