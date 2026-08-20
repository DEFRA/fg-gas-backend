import { randomUUID } from "node:crypto";
import { config } from "../../common/config.js";

// The Payment Service consumes the envelope the legacy Agreements API published,
// so the type and source are its literal values rather than the
// cloud.defra.{environment}.{service} namespace GAS uses for its own events.
// Changing either changes the Payment Service contract.
const CREATE_PAYMENT_TYPE = "io.onsite.agreement.create-payment";
const CREATE_PAYMENT_SOURCE = "urn:service:agreement";

// The legacy message sends every monetary value as a string. Pence stay numeric
// on the Payment and are stringified here, at the boundary, and nowhere else.
const toPence = (pence) => pence.toString();

// Copy the complete legacy Payment Service contract. These accounting fields
// are required by Payment Service even though GAS does not otherwise use them.
const toInvoiceLine = ({
  accountCode,
  amountPence,
  deliveryBody,
  description,
  fundCode,
  marketingYear,
  schemeCode,
}) => ({
  accountCode,
  amountPence: toPence(amountPence),
  deliveryBody,
  description,
  fundCode,
  marketingYear,
  schemeCode,
});

const toDuePayment = ({
  dueDate,
  totalAmountPence,
  status,
  correlationId,
  invoiceLines,
}) => ({
  dueDate,
  totalAmountPence: toPence(totalAmountPence),
  status,
  correlationId,
  invoiceLines: invoiceLines.map(toInvoiceLine),
});

const toGrant = (payment) => ({
  sourceSystem: payment.sourceSystem,
  deliveryBody: payment.deliveryBody,
  fesCode: payment.fesCode,
  paymentRequestNumber: payment.paymentRequestNumber,
  correlationId: payment.correlationId,
  invoiceNumber: payment.invoiceNumber,
  ledger: payment.ledger,
  originalInvoiceNumber: payment.originalInvoiceNumber,
  agreementNumber: payment.source.agreementNumber,
  totalAmountPence: toPence(payment.totalAmountPence),
  currency: payment.currency,
  marketingYear: payment.marketingYear,
  payments: payment.payments.map(toDuePayment),
});

const createPaymentEvent = (payment) => ({
  id: randomUUID(),
  source: CREATE_PAYMENT_SOURCE,
  specversion: "1.0",
  type: CREATE_PAYMENT_TYPE,
  time: new Date().toISOString(),
  datacontenttype: "application/json",
  data: {
    sbi: payment.sbi,
    frn: payment.frn,
    claimId: payment.paymentHubClaimId,
    scheme: payment.scheme,
    grants: [toGrant(payment)],
  },
});

/**
 * Turns a persisted Payment into the outbox record that publishes it to the
 * Payment Service.
 *
 * Everything the message needs is already on the Payment, so building it never
 * loads the Agreement or its definition. The Agreement Number is the outbox
 * segregation reference, which keeps a single Agreement's payment events in
 * order behind one FIFO lock and becomes the SNS FIFO message group ID when the
 * outbox subscriber publishes it.
 */
export const createPaymentPublication = (payment) => ({
  event: createPaymentEvent(payment),
  target: config.sns.createPaymentTopicArn,
  segregationRef: payment.source.agreementNumber,
});
