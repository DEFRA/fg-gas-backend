import Joi from "joi";
import { code } from "../grant/code.js";
export const phaseStageStatus = Joi.string()
  .pattern(/^[A-Z_]+$/)
  .example("PHASE_ONE");

export const applicationStatusResponseSchema = Joi.object({
  grantCode: code.label("grantCode"),
  clientRef: code.label("clientRef"),
  phase: phaseStageStatus.label("phase"),
  stage: phaseStageStatus.label("stage"),
  status: phaseStageStatus.label("status"),
})
  .options({
    presence: "required",
    stripUnknown: true,
  })
  .label("ApplicationStatusResponse");
