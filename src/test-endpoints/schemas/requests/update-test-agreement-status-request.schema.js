import Joi from "joi";

// Target states, not action names. AgreementDefinition.resolveActionForStatus
// resolves by transition target, so "withdrawn" is correct and "withdraw" is
// not. States are lower case in the Agreements domain; do not use the upper
// case AgreementStatus enum from src/grants/models/agreement.js here.
export const supportedTestStatuses = ["withdrawn", "cancelled", "terminated"];

export const updateTestAgreementStatusParamsSchema = Joi.object({
  agreementNumber: Joi.string().required(),
}).label("UpdateTestAgreementStatusParams");

export const updateTestAgreementStatusPayloadSchema = Joi.object({
  status: Joi.string()
    .valid(...supportedTestStatuses)
    .required(),
}).label("UpdateTestAgreementStatusPayload");
