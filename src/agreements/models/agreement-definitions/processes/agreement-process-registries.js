import Boom from "@hapi/boom";
import Joi from "joi";
import {
  agreementDateSchema,
  agreementValueSchema,
  capitalItemSchema,
  parcelSchema,
  paymentScheduleSchema,
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
    locations: Object.freeze(["action"]),
  }),
});

const outputSchemas = {
  startDate: agreementDateSchema,
  endDate: agreementDateSchema,
  parcels: Joi.array().items(parcelSchema).unique("id"),
  actions: Joi.array().items(revenueActionSchema).unique("id"),
  items: Joi.array().items(capitalItemSchema).unique("id"),
  annualAmountPence: penceSchema,
  totalAmountPence: penceSchema,
  paymentSchedule: paymentScheduleSchema,
};

export const findProcessOutputSchema = (name) =>
  Object.hasOwn(outputSchemas, name) ? outputSchemas[name] : undefined;
