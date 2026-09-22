import Boom from "@hapi/boom";
import Joi from "joi";
import { CloudEvent } from "../../common/cloud-event.js";
import { config } from "../../common/config.js";

const type = "agreement.payment.requested";

export const AGREEMENT_PAYMENT_REQUESTED_EVENT_TYPE = `cloud.defra.${config.cdpEnvironment}.${config.serviceName}.${type}`;

const requestSchema = Joi.object({
  agreement: Joi.object({
    agreementNumber: Joi.string().required(),
    version: Joi.number().integer().min(1).required(),
    code: Joi.string().required(),
    configVersion: Joi.string().required(),
    correlationId: Joi.string().required(),
  })
    .unknown(true)
    .required(),
  executedAt: Joi.string().isoDate().required(),
});

const validate = (props) => {
  const { error, value } = requestSchema.validate(props, {
    abortEarly: false,
    allowUnknown: false,
    convert: false,
  });

  if (error) {
    throw Boom.badRequest(
      `Invalid AgreementPaymentRequested: ${error.details.map((detail) => detail.message).join(", ")}`,
    );
  }

  return value;
};

const deepFreeze = (value) => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }

  return value;
};

export class AgreementPaymentRequestedEvent extends CloudEvent {
  constructor(props) {
    const { agreement, executedAt } = validate(props);
    const snapshot = structuredClone(agreement);
    const source = {
      agreementNumber: agreement.agreementNumber,
      agreementVersion: agreement.version,
    };

    super(
      type,
      {
        requestId: `agreement:${agreement.agreementNumber}:v${agreement.version}`,
        source,
        code: agreement.code,
        configVersion: agreement.configVersion,
        executedAt,
        snapshot,
      },
      agreement.agreementNumber,
    );

    deepFreeze(this.data);
    Object.freeze(this);
  }
}
