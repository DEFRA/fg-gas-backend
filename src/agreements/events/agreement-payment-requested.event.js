import Joi from "joi";
import { CloudEvent } from "../../common/cloud-event.js";
import { config } from "../../common/config.js";
import { deepFreeze, validateEventProps } from "../../events/event-contract.js";

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

export class AgreementPaymentRequestedEvent extends CloudEvent {
  constructor(props) {
    const { agreement, executedAt } = validateEventProps(
      requestSchema,
      props,
      "AgreementPaymentRequested",
    );
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
