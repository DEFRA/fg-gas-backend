import Boom from "@hapi/boom";
import Joi from "joi";
import { CloudEvent } from "../../common/cloud-event.js";
import { config } from "../../common/config.js";

const type = "claim.payment.requested";

export const CLAIM_PAYMENT_REQUESTED_EVENT_TYPE = `cloud.defra.${config.cdpEnvironment}.${config.serviceName}.${type}`;

const requestSchema = Joi.object({
  code: Joi.string().required(),
  clientRef: Joi.string().required(),
  clientClaimRef: Joi.string().required(),
  entitlementId: Joi.string().required(),
  configVersion: Joi.string().required(),
  agreement: Joi.object({
    agreementNumber: Joi.string().required(),
    agreementVersion: Joi.number().integer().min(1).required(),
    correlationId: Joi.string().required(),
  }).required(),
  executedAt: Joi.string().isoDate().required(),
  claim: Joi.object().unknown(true).required(),
});

const validate = (props) => {
  const { error, value } = requestSchema.validate(props, {
    abortEarly: false,
    allowUnknown: false,
    convert: false,
  });

  if (error) {
    throw Boom.badRequest(
      `Invalid ClaimPaymentRequested: ${error.details.map((detail) => detail.message).join(", ")}`,
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

export class ClaimPaymentRequestedEvent extends CloudEvent {
  constructor(props) {
    const {
      agreement,
      claim,
      clientClaimRef,
      clientRef,
      code,
      configVersion,
      entitlementId,
      executedAt,
    } = validate(props);
    const source = { code, clientRef, clientClaimRef, entitlementId };

    super(
      type,
      {
        requestId: `claim:${code}:${clientRef}:${clientClaimRef}`,
        source,
        agreement: structuredClone(agreement),
        configVersion,
        executedAt,
        snapshot: structuredClone(claim),
      },
      clientRef,
    );

    deepFreeze(this.data);
    Object.freeze(this);
  }
}
