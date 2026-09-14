import Joi from "joi";
import { clientRef } from "../application/metadata/client-ref.js";
import { configVersion } from "../application/metadata/config-version.js";
import { crn } from "../application/metadata/crn.js";
import { frn } from "../application/metadata/frn.js";
import { sbi } from "../application/metadata/sbi.js";
import { submittedAt } from "../application/metadata/submitted-at.js";
import { code } from "../grant/code.js";

const clientClaimRef = Joi.string()
  .pattern(/^[A-Za-z0-9-]+$/)
  .example("WMP-6HB-J8E-C0001");

export const submitClaimRequestSchema = Joi.object({
  metadata: Joi.object({
    grantCode: code.required(),
    clientRef,
    // Dropped from the contract: the claim names its entitlement and the code
    // is read from that record. Rejected rather than ignored so a caller still
    // sending one is told its value no longer has any effect.
    claimCode: Joi.any().forbidden(),
    clientClaimRef: clientClaimRef.required(),
    sbi,
    frn,
    crn,
    submittedAt: submittedAt.optional(),
    configVersion: configVersion
      .message("Config version must be a valid config string (e.g. 1.0.3)")
      .required(),
  }).unknown(true),
  claim: Joi.object({
    entitlementId: Joi.string().required(),
    // The rest of the body is passed through as sent. This field is declared
    // because Payment definitions map it, so a wrong type fails here rather
    // than during resolution, which disables the definition for later Claims.
    totalClaimAmountPence: Joi.number().integer().min(0).optional(),
  }).unknown(),
})
  .options({
    presence: "required",
    stripUnknown: true,
  })
  .label("SubmitClaimRequest");
