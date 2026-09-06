import Joi from "joi";

const paymentHandlerInputSchema = Joi.object({}).required();

const paymentCommitOperationsSchema = Joi.object({
  commitOperations: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().valid("create-agreement-payment").required(),
      }).required(),
    )
    .length(1)
    .required(),
}).required();

const stageAgreementPayment = () => ({
  commitOperations: [{ type: "create-agreement-payment" }],
});

export const agreementProcessHandlers = Object.freeze({
  CREATE_AGREEMENT_PAYMENT: Object.freeze({
    inputSchema: paymentHandlerInputSchema,
    commitOperationsSchema: paymentCommitOperationsSchema,
    execute: stageAgreementPayment,
    locations: Object.freeze(["transition"]),
  }),
});
