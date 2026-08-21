import Boom from "@hapi/boom";
import Joi from "joi";
import { agreementValueSchema } from "../../../schemas/agreement-value.schema.js";

const acceptedAgreementValuesSchema = agreementValueSchema
  .fork("application", (schema) => schema.forbidden())
  .fork(
    ["startDate", "endDate", "totalAmountPence", "paymentSchedule"],
    (schema) => schema.required(),
  )
  .required();

// ponytail: accept the previous inline shape during rollout; remove once every
// grant config publishes payment.json.
const paymentHandlerInputSchema = Joi.object({
  payment: Joi.object().unknown(true).optional(),
}).required();

const paymentCommitOperationsSchema = Joi.object({
  commitOperations: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().valid("create-agreement-payment").required(),
        request: Joi.object({
          agreementValues: acceptedAgreementValuesSchema,
          paymentConfiguration: Joi.object().unknown(true).required(),
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

const missingPaymentDefinition = () => {
  throw Boom.badImplementation(
    "CREATE_AGREEMENT_PAYMENT requires a Payment definition",
  );
};

export const createAgreementProcessHandlers = ({
  resolvePaymentConfiguration = missingPaymentDefinition,
} = {}) => {
  const stageAgreementPayment = async ({ agreement, execution }) => ({
    commitOperations: [
      {
        type: "create-agreement-payment",
        request: {
          agreementValues: selectPaymentAgreementValues(agreement),
          paymentConfiguration: await resolvePaymentConfiguration({
            executedAt: execution.executedAt,
          }),
        },
      },
    ],
  });

  return Object.freeze({
    CREATE_AGREEMENT_PAYMENT: Object.freeze({
      inputSchema: paymentHandlerInputSchema,
      commitOperationsSchema: paymentCommitOperationsSchema,
      execute: stageAgreementPayment,
      locations: Object.freeze(["transition"]),
    }),
  });
};

export const agreementProcessHandlers = createAgreementProcessHandlers();
