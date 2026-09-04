import Joi from "joi";

const MIN_REASON = 1;
const MAX_REASON = 512;

// Parking is a deliberate, recorded act: an operator is declaring a row poison
// and taking it out of the retry loop for good, so a reason is REQUIRED, is
// stored on the document and is written into the audit event. 512 characters
// is the same cap an attempt-history message gets, for the same reason - it
// lives on the document forever.
export const parkBodySchema = Joi.object({
  reason: Joi.string()
    .trim()
    .min(MIN_REASON)
    .max(MAX_REASON)
    .required()
    .example("poison payload - caseRef does not exist and never will"),
}).label("ParkEventBody");
