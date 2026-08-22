import Joi from "joi";

const mapping = Joi.any().required();

export const paymentDefinitionSchema = Joi.object({
  code: Joi.string().required(),
  sbi: mapping,
  frn: mapping,
  originalInvoiceNumber: mapping,
  scheme: mapping,
  sourceSystem: mapping,
  deliveryBody: mapping,
  fesCode: mapping,
  ledger: mapping,
  totalAmountPence: mapping,
  currency: mapping,
  marketingYear: mapping,
  duePayments: mapping,
}).unknown(false);

const penceSchema = Joi.number().integer().strict().required();

const invoiceLineSchema = Joi.object({
  schemeCode: Joi.string().required(),
  description: Joi.string().required(),
  amountPence: penceSchema,
  accountCode: Joi.string().required(),
  fundCode: Joi.string().required(),
}).unknown(false);

const duePaymentSchema = Joi.object({
  dueDate: Joi.string().required(),
  totalAmountPence: penceSchema,
  invoiceLines: Joi.array().items(invoiceLineSchema).min(1).required(),
}).unknown(false);

const balancesWithInvoiceLines = (duePayments, helpers) => {
  const unbalanced = duePayments.find(
    ({ totalAmountPence, invoiceLines }) =>
      BigInt(totalAmountPence) !==
      invoiceLines.reduce(
        (total, invoiceLine) => total + BigInt(invoiceLine.amountPence),
        0n,
      ),
  );

  return unbalanced
    ? helpers.message({
        custom: `payment due ${unbalanced.dueDate} does not balance with its invoice lines`,
      })
    : duePayments;
};

const balancesWithDuePayments = (payment, helpers) => {
  const duePaymentsTotal = payment.duePayments.reduce(
    (total, duePayment) => total + BigInt(duePayment.totalAmountPence),
    0n,
  );

  return BigInt(payment.totalAmountPence) === duePaymentsTotal
    ? payment
    : helpers.message({
        custom: "totalAmountPence does not balance with duePayments",
      });
};

export const resolvedPaymentValueSchema = Joi.object({
  sbi: Joi.string().required(),
  frn: Joi.string().required(),
  originalInvoiceNumber: Joi.string().allow("").required(),
  scheme: Joi.string().required(),
  sourceSystem: Joi.string().required(),
  deliveryBody: Joi.string().required(),
  fesCode: Joi.string().required(),
  ledger: Joi.string().required(),
  totalAmountPence: penceSchema,
  currency: Joi.string().required(),
  marketingYear: Joi.string().required(),
  duePayments: Joi.array()
    .items(duePaymentSchema)
    .min(1)
    .custom(balancesWithInvoiceLines)
    .required(),
})
  .unknown(false)
  .custom(balancesWithDuePayments)
  .strict();
