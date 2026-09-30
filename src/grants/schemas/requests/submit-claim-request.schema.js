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
    totalClaimAmountPence: Joi.number().integer().min(0).required(),
    // What the claim is for, in the caller's own units. Optional because only
    // the grants that measure a claim send it, but neither half is any use
    // alone, so a quantity without its unit is rejected rather than shown
    // unlabelled on the Claims page.
    totalEligibleArea: Joi.number().min(0).optional(),
    unit: Joi.string().optional(),
  })
    .and("totalEligibleArea", "unit")
    .unknown(),
})
  .options({
    presence: "required",
    stripUnknown: true,
  })
  .label("SubmitClaimRequest");
