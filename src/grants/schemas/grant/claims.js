import Joi from "joi";

// entitlement-template.js's templatePosition allows a phase-only or
// phase+stage-only position, matching by prefix - right for "available
// anywhere in this phase", wrong here: claimApprovalTransitionFor compares
// all three parts, so a position that leaves one out could never match at
// runtime, or would silently under-specify an exact-match config. Every
// part is required.
const claimPosition = Joi.object({
  phase: Joi.string().required(),
  stage: Joi.string().required(),
  status: Joi.string().required(),
})
  .unknown(false)
  .label("ClaimPosition");

const onClaimApproval = Joi.object({
  currentPosition: claimPosition.required(),
  targetPosition: claimPosition.required(),
})
  .unknown(false)
  .label("OnClaimApproval");

export const claims = Joi.object({
  onClaimApproval: onClaimApproval.optional(),
})
  .unknown(false)
  .label("Claims");
