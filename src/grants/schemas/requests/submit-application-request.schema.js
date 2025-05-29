import Joi from "joi";
import { clientRef } from "../application/metadata/client-ref.js";
import { crn } from "../application/metadata/crn.js";
import { defraId } from "../application/metadata/defra-id.js";
import { frn } from "../application/metadata/frn.js";
import { sbi } from "../application/metadata/sbi.js";
import { submittedAt } from "../application/metadata/submitted-at.js";

export const submitApplicationRequestSchema = Joi.object({
  metadata: Joi.object({
    clientRef,
    sbi,
    frn,
    crn,
    defraId,
    submittedAt: submittedAt.optional(),
  }),
  answers: Joi.object({}).unknown(),
})
  .options({
    presence: "required",
    stripUnknown: true,
  })
  .label("CreateApplicationRequest");
