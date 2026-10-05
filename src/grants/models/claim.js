import Boom from "@hapi/boom";
import Joi from "joi";
import { claimDetailsSchema } from "./claim-details.schema.js";

const deepFreeze = (value) => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }

  return value;
};

/**
 * An immutable record of a Claim submitted against one Entitlement.
 *
 * `metadata` and `claim` are the submitted request bodies, kept as sent. The
 * Claim validates the baseline claim fields while retaining grant-specific
 * fields and metadata.
 *
 * `clientClaimRef` is the callers key and is unique only within
 * `code` and `clientRef`, so the three together are the Claim's identity.
 */
export class Claim {
  static validationSchema = Joi.object({
    code: Joi.string().required(),
    clientRef: Joi.string().required(),
    claimCode: Joi.string().required(),
    clientClaimRef: Joi.string().required(),
    entitlementId: Joi.string().required(),
    metadata: Joi.object().unknown(true).required(),
    claim: claimDetailsSchema.keys({
      entitlementId: claimDetailsSchema
        .extract("entitlementId")
        .valid(Joi.ref("/entitlementId")),
    }),
    createdAt: Joi.string().required(),
    updatedAt: Joi.string().required(),
  });

  constructor(props) {
    const { error, value } = Claim.validationSchema.validate(props, {
      abortEarly: false,
    });

    if (error) {
      throw Boom.badRequest(
        `Invalid Claim: ${error.details.map((detail) => detail.message).join(", ")}`,
      );
    }

    this.code = value.code;
    this.clientRef = value.clientRef;
    this.claimCode = value.claimCode;
    this.clientClaimRef = value.clientClaimRef;
    this.entitlementId = value.entitlementId;
    this.metadata = structuredClone(value.metadata);
    this.claim = structuredClone(value.claim);
    this.createdAt = value.createdAt;
    this.updatedAt = value.updatedAt;

    deepFreeze(this);
  }

  static fromDocument(doc) {
    return new Claim({
      code: doc.code,
      clientRef: doc.clientRef,
      claimCode: doc.claimCode,
      clientClaimRef: doc.clientClaimRef,
      entitlementId: doc.entitlementId,
      metadata: doc.metadata,
      claim: doc.claim,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  static create({ createdAt = new Date().toISOString(), ...props }) {
    return new Claim({
      ...props,
      entitlementId: props.claim?.entitlementId,
      createdAt,
      updatedAt: createdAt,
    });
  }
}
