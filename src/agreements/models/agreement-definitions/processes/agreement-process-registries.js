import Joi from "joi";
import {
  agreementDateSchema,
  agreementValueSchema,
  applicantSchema,
  capitalItemSchema,
  parcelSchema,
  penceSchema,
  revenueActionSchema,
} from "../../../schemas/agreement-value.schema.js";

const paymentConfigurationSchema = Joi.object({
  scheme: Joi.string().required(),
  sourceSystem: Joi.string().required(),
  deliveryBody: Joi.string().required(),
  fesCode: Joi.string().required(),
  ledger: Joi.string().required(),
  currency: Joi.string().required(),
  marketingYear: Joi.string().required(),
  invoiceLine: Joi.object({
    schemeCode: Joi.string().required(),
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
  agreementValues: acceptedAgreementValuesSchema,
  payment: paymentConfigurationSchema,
}).required();

const paymentIntentSchema = Joi.object({
  intents: Joi.array()
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

const stageAgreementPayment = ({ input }) => ({
  intents: [
    {
      type: "create-agreement-payment",
      request: {
        agreementValues: input.agreementValues,
        paymentConfiguration: input.payment,
      },
    },
  ],
});

export const agreementProcessHandlers = Object.freeze({
  CREATE_AGREEMENT_PAYMENT: Object.freeze({
    inputSchema: paymentHandlerInputSchema,
    intentSchema: paymentIntentSchema,
    execute: stageAgreementPayment,
    locations: Object.freeze(["transition"]),
  }),
});

const withoutPersistentIdentity = (schema) =>
  schema.fork("id", (idSchema) => idSchema.forbidden());

const candidateEntrySchema = (schema) =>
  withoutPersistentIdentity(schema).append({ ref: Joi.string().optional() });

const revenueActionCandidateSchema = candidateEntrySchema(revenueActionSchema);
const capitalItemCandidateSchema = candidateEntrySchema(capitalItemSchema);

const candidateLineItemSchema = Joi.object({
  actionRef: Joi.string().optional(),
  itemRef: Joi.string().optional(),
  amountPence: penceSchema.required(),
})
  .xor("actionRef", "itemRef")
  .label("CandidatePaymentScheduleLineItem");

const candidateInstalmentSchema = Joi.object({
  dueDate: agreementDateSchema.required(),
  totalAmountPence: penceSchema.required(),
  lineItems: Joi.array().items(candidateLineItemSchema).required(),
}).label("CandidatePaymentScheduleInstalment");

const candidatePaymentScheduleSchema = Joi.object({
  frequency: Joi.string().optional(),
  instalments: Joi.array().items(candidateInstalmentSchema).required(),
}).label("CandidatePaymentSchedule");

const outputSchemas = {
  schemeCode: agreementValueSchema.extract("schemeCode"),
  name: agreementValueSchema.extract("name"),
  applicant: applicantSchema,
  startDate: agreementDateSchema,
  endDate: agreementDateSchema,
  parcels: Joi.array().items(parcelSchema).unique("id"),
  actions: Joi.array().items(revenueActionCandidateSchema),
  items: Joi.array().items(capitalItemCandidateSchema),
  annualAmountPence: penceSchema,
  totalAmountPence: penceSchema,
  paymentSchedule: candidatePaymentScheduleSchema,
};

export const findProcessOutputSchema = (name) =>
  Object.hasOwn(outputSchemas, name) ? outputSchemas[name] : undefined;
