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
    claimCode: Joi.string().required(),
    clientClaimRef: clientClaimRef.required(),
    sbi,
    frn,
    crn,
    submittedAt: submittedAt.optional(),
    configVersion: configVersion
      .message("Config version must be a valid config string (e.g. 1.0.3)")
      .required(),
  }).unknown(true),
  claim: Joi.object({}).unknown(),
})
  .options({
    presence: "required",
    stripUnknown: true,
  })
  .label("SubmitClaimRequest");
