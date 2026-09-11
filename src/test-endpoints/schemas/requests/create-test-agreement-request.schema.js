import Joi from "joi";

// The Agreement creation contract is defined by CreateAgreementCommand
// (src/grants/events/create-agreement.command.js), which is the only producer
// of "agreement.create" in normal processing. This schema mirrors that data
// object so test-created Agreements are indistinguishable from real ones.
//
// "answers" is deliberately unvalidated: each grant's agreement definition
// decides what it reads via a JSONata path (for example PMF uses
// "$.input.answers"), so GAS cannot validate its shape centrally.
export const createTestAgreementPayloadSchema = Joi.object({
  code: Joi.string().required(),
  clientRef: Joi.string().required(),
  currentConfigVersion: Joi.string().required(),
  identifiers: Joi.object({
    sbi: Joi.string().required(),
  })
    .unknown(true)
    .required(),
  answers: Joi.object().unknown(true).default({}),
  metadata: Joi.object().unknown(true).default({}),
}).label("CreateTestAgreementPayload");
