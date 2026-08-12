import Joi from "joi";
import {
  agreementDateSchema,
  agreementValueSchema,
  applicantSchema,
  capitalItemSchema,
  parcelSchema,
  penceSchema,
  revenueActionSchema,
} from "./agreement-value.schema.js";

const commonValueFields = {
  schemeCode: agreementValueSchema.extract("schemeCode"),
  name: agreementValueSchema.extract("name"),
  applicant: applicantSchema,
  startDate: agreementDateSchema,
  endDate: agreementDateSchema,
  parcels: Joi.array().items(parcelSchema).unique("id"),
  annualAmountPence: penceSchema,
  totalAmountPence: penceSchema,
};

const processCandidateEntrySchema = (schema) =>
  schema
    .fork("id", (idSchema) => idSchema.forbidden())
    .append({ ref: Joi.string().optional() });

const transitionCandidateEntrySchema = (schema) =>
  schema
    .fork("id", (idSchema) => idSchema.optional())
    .append({ ref: Joi.string().optional() });

const processActionCandidatesSchema = Joi.array().items(
  processCandidateEntrySchema(revenueActionSchema),
);
const processItemCandidatesSchema = Joi.array().items(
  processCandidateEntrySchema(capitalItemSchema),
);
const transitionActionCandidatesSchema = Joi.array().items(
  transitionCandidateEntrySchema(revenueActionSchema),
);
const transitionItemCandidatesSchema = Joi.array().items(
  transitionCandidateEntrySchema(capitalItemSchema),
);

const paymentLineItemValueFields = {
  amountPence: penceSchema.required(),
  description: Joi.string().optional(),
};

const processPaymentLineItemSchema = Joi.object({
  ...paymentLineItemValueFields,
  actionRef: Joi.string().optional(),
  itemRef: Joi.string().optional(),
})
  .xor("actionRef", "itemRef")
  .label("ProcessPaymentScheduleLineItem");

const transitionPaymentLineItemSchema = Joi.object({
  ...paymentLineItemValueFields,
  actionId: Joi.string().optional(),
  itemId: Joi.string().optional(),
  actionRef: Joi.string().optional(),
  itemRef: Joi.string().optional(),
})
  .xor("actionId", "itemId", "actionRef", "itemRef")
  .label("TransitionPaymentScheduleLineItem");

const paymentInstalmentValueFields = {
  dueDate: agreementDateSchema.required(),
  totalAmountPence: penceSchema.required(),
  correlationId: Joi.string().optional(),
};

const processPaymentInstalmentSchema = Joi.object({
  ...paymentInstalmentValueFields,
  lineItems: Joi.array().items(processPaymentLineItemSchema).required(),
}).label("ProcessPaymentScheduleInstalment");

const transitionPaymentInstalmentSchema = Joi.object({
  ...paymentInstalmentValueFields,
  id: Joi.string().optional(),
  lineItems: Joi.array().items(transitionPaymentLineItemSchema).required(),
}).label("TransitionPaymentScheduleInstalment");

const paymentScheduleValueFields = {
  frequency: Joi.string().optional(),
};

const processPaymentScheduleSchema = Joi.object({
  ...paymentScheduleValueFields,
  instalments: Joi.array().items(processPaymentInstalmentSchema).required(),
}).label("ProcessPaymentSchedule");

const transitionPaymentScheduleSchema = Joi.object({
  ...paymentScheduleValueFields,
  instalments: Joi.array().items(transitionPaymentInstalmentSchema).required(),
}).label("TransitionPaymentSchedule");

const processOutputSchemas = {
  ...commonValueFields,
  actions: processActionCandidatesSchema,
  items: processItemCandidatesSchema,
  paymentSchedule: processPaymentScheduleSchema,
};

export const findAgreementProcessOutputSchema = (field) =>
  Object.hasOwn(processOutputSchemas, field)
    ? processOutputSchemas[field]
    : undefined;

export const transitionAgreementValueCandidateSchema = Joi.object({
  ...commonValueFields,
  application: Joi.object().unknown(true).required(),
  actions: transitionActionCandidatesSchema.required(),
  items: transitionItemCandidatesSchema.required(),
  paymentSchedule: transitionPaymentScheduleSchema,
});
