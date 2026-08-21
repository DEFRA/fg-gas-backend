import Boom from "@hapi/boom";
import Joi from "joi";

export const CREATE_AGREEMENT_PAYMENT = "CREATE_AGREEMENT_PAYMENT";

const paymentHandlerInputSchema = Joi.object({}).required();

const paymentCommitOperationsSchema = Joi.object({
  commitOperations: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().valid("create-agreement-payment").required(),
        request: Joi.object({
          paymentConfiguration: Joi.object().unknown(true).required(),
        }).required(),
      }).required(),
    )
    .length(1)
    .required(),
}).required();

const missingPaymentDefinition = async () => {
  throw Boom.badImplementation(
    `${CREATE_AGREEMENT_PAYMENT} requires a Payment definition`,
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
          paymentConfiguration: await resolvePaymentConfiguration({
            execution,
            agreement,
          }),
        },
      },
    ],
  });

  return Object.freeze({
    [CREATE_AGREEMENT_PAYMENT]: Object.freeze({
      inputSchema: paymentHandlerInputSchema,
      commitOperationsSchema: paymentCommitOperationsSchema,
      execute: stageAgreementPayment,
      locations: Object.freeze(["transition"]),
    }),
  });
};

export const agreementProcessHandlers = createAgreementProcessHandlers();
