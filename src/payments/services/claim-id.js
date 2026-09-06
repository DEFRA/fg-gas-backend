const CLAIM_ID_PADDING = 8;
const INVOICE_NUMBER_PADDING = 3;

// Mirrors the legacy Agreements API formats so the Payment Service continues to
// recognise the identifiers it receives.
export const formatClaimId = (sequence) =>
  `R${String(sequence).padStart(CLAIM_ID_PADDING, "0")}`;

export const formatInvoiceNumber = (claimId, paymentRequestNumber) =>
  `${claimId}-V${String(paymentRequestNumber).padStart(INVOICE_NUMBER_PADDING, "0")}QX`;
