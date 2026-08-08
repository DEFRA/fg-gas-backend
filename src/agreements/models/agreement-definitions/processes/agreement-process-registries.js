import Joi from "joi";
import { agreementValueSchema } from "../../../schemas/agreement-value.schema.js";

const paymentConfigurationSchema = Joi.object({
  scheme: Joi.string().required(),
  sourceSystem: Joi.string().required(),
  deliveryBody: Joi.string().required(),
  fesCode: Joi.string().required(),
  ledger: Joi.string().required(),
  currency: Joi.string().required(),
  marketingYear: Joi.string().required(),
  invoiceLine: Joi.object({
    schemeCode: Joi.string().optional(),
    accountCode: Joi.string().required(),
    fundCode: Joi.string().required(),
  }).required(),
}).required();

const acceptedAgreementValuesSchema = agreementValueSchema
  .fork("application", (schema) => schema.forbidden())
  .fork(
    ["startDate", "endDate", "totalAmountPence", "paymentSchedule"],
    (schema) => schema.required(),
  )
  .required();

const paymentHandlerInputSchema = Joi.object({
  payment: paymentConfigurationSchema,
}).required();

const paymentCommitOperationsSchema = Joi.object({
  commitOperations: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().valid("create-agreement-payment").required(),
        request: Joi.object({
          agreementValues: acceptedAgreementValuesSchema,
          paymentConfiguration: paymentConfigurationSchema,
        }).required(),
      }).required(),
    )
    .length(1)
    .required(),
}).required();

const paymentAgreementValueFields = [
  "startDate",
  "endDate",
  "actions",
  "items",
  "totalAmountPence",
  "paymentSchedule",
];

const selectPaymentAgreementValues = (agreement) =>
  Object.fromEntries(
    paymentAgreementValueFields.map((field) => [field, agreement[field]]),
  );

const stageAgreementPayment = ({ agreement, input }) => ({
  commitOperations: [
    {
      type: "create-agreement-payment",
      request: {
        agreementValues: selectPaymentAgreementValues(agreement),
        paymentConfiguration: input.payment,
      },
    },
  ],
});

export const agreementProcessHandlers = Object.freeze({
  CREATE_AGREEMENT_PAYMENT: Object.freeze({
    inputSchema: paymentHandlerInputSchema,
    commitOperationsSchema: paymentCommitOperationsSchema,
    execute: stageAgreementPayment,
    locations: Object.freeze(["transition"]),
  }),
});
