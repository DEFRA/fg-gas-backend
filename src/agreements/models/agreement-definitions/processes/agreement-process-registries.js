import Boom from "@hapi/boom";
import Joi from "joi";

export const CREATE_AGREEMENT_PAYMENT = "CREATE_AGREEMENT_PAYMENT";

const paymentHandlerInputSchema = Joi.object({}).required();

const missingPaymentHandler = async () => {
  throw Boom.badImplementation(
    `${CREATE_AGREEMENT_PAYMENT} requires a Payments handler`,
  );
};

export const createAgreementProcessHandlers = ({
  prepareAgreementPayment = missingPaymentHandler,
} = {}) =>
  Object.freeze({
    [CREATE_AGREEMENT_PAYMENT]: Object.freeze({
      inputSchema: paymentHandlerInputSchema,
      execute: prepareAgreementPayment,
      locations: Object.freeze(["transition"]),
    }),
  });

export const agreementProcessHandlers = createAgreementProcessHandlers();
