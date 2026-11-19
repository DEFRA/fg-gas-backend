import { paymentsCollection } from "../repositories/payment.repository.js";

const AGREEMENT_NUMBER = "source.agreementNumber";

const fieldOf = (part, key) => (part ? (part[key] ?? null) : null);

const ownOrAgreement = (doc, key) =>
  fieldOf(doc.source, key) ?? fieldOf(doc.agreement, key);

// Most payment requests hold neither application nor grant: they are read
// from the agreement the payment is for.
const openApplication = (doc) => {
  const code = ownOrAgreement(doc, "code");
  const ref = ownOrAgreement(doc, "clientRef");

  return code && ref ? { kind: "application", code, ref } : null;
};

export const paymentsSource = {
  name: "payments",
  label: "Payments, in the Grant Application Service",
  service: "GAS",
  size: "small",
  requires: null,
  collection: paymentsCollection,
  time: "createdAt",
  noun: { one: "payment", many: "payments" },
  star: [
    "invoiceNumber",
    AGREEMENT_NUMBER,
    "payments.status",
    "totalAmountPence",
    "payments.dueDate",
  ],
  roots: [
    "invoiceNumber",
    "originalInvoiceNumber",
    "paymentRequestNumber",
    "source",
    "sbi",
    "frn",
    "scheme",
    "marketingYear",
    "ledger",
    "currency",
    "totalAmountPence",
    "payments",
    "createdAt",
  ],
  answersAt: null,
  attach: [
    {
      as: "agreement",
      noun: "agreements",
      source: "agreements",
      on: [[AGREEMENT_NUMBER, "agreementNumber"]],
    },
  ],
  open: openApplication,
  openPaths: [
    "source.code",
    "source.clientRef",
    "agreement.code",
    "agreement.clientRef",
  ],
  paths: [
    { path: "invoiceNumber", type: "text" },
    { path: AGREEMENT_NUMBER, type: "text" },
    { path: "source.clientRef", type: "text" },
    { path: "source.code", type: "text" },
    { path: "agreement.clientRef", type: "text" },
    { path: "agreement.code", type: "text" },
    { path: "sbi", type: "text" },
    { path: "frn", type: "text" },
    { path: "payments.status", type: "text" },
    { path: "payments.dueDate", type: "date" },
    { path: "payments.totalAmountPence", type: "number" },
    { path: "totalAmountPence", type: "number" },
    { path: "marketingYear", type: "text" },
    { path: "createdAt", type: "date" },
  ],
};
