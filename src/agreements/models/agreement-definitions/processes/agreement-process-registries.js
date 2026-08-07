import Boom from "@hapi/boom";
import Joi from "joi";
import {
  agreementDateSchema,
  agreementValueSchema,
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
  invoiceLine: Joi.object({
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

const executeDeferredPayment = () => {
  throw Boom.badImplementation(
    'Agreement Process handler "create-agreement-payment" is not implemented',
  );
};

export const agreementProcessHandlers = Object.freeze({
  "create-agreement-payment": Object.freeze({
    inputSchema: Joi.object({
      agreementValues: acceptedAgreementValuesSchema,
      payment: paymentConfigurationSchema,
    }).required(),
    execute: executeDeferredPayment,
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
