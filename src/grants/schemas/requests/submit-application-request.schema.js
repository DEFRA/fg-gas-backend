import Joi from "joi";
import { clientRef } from "../application/metadata/client-ref.js";
import { configVersion } from "../application/metadata/config-version.js";
import { crn } from "../application/metadata/crn.js";
import { frn } from "../application/metadata/frn.js";
import { sbi } from "../application/metadata/sbi.js";
import { submittedAt } from "../application/metadata/submitted-at.js";

export const submitApplicationRequestSchema = Joi.object({
  metadata: Joi.object({
    previousClientRef: clientRef.optional(),
    clientRef,
    sbi,
    frn,
    crn,
    submittedAt: submittedAt.optional(),
    configVersion: configVersion
      .message("Config version must be a valid config string (e.g. 1.0.3)")
      .required(),
  }).unknown(true),
  answers: Joi.object({}).unknown(),
})
  .options({
    presence: "required",
    stripUnknown: true,
  })
  .label("CreateApplicationRequest");
