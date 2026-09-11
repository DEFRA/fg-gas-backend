import Joi from "joi";

// A deliberately small, stable contract for the QA suites. The Agreement shape
// itself is grant-defined and free to grow, so agreementData allows unknown
// keys and only pins the fields the tests assert on.
const testAgreementDataSchema = Joi.object({
  agreementNumber: Joi.string().required(),
  code: Joi.string().required(),
  clientRef: Joi.string().required(),
  state: Joi.string().required(),
  version: Joi.number().required(),
  identifiers: Joi.object().unknown(true).required(),
  createdAt: Joi.string().required(),
  updatedAt: Joi.string().allow(null),
})
  .unknown(true)
  .label("TestAgreementData");

export const testAgreementResponseSchema = Joi.object({
  message: Joi.string().required(),
  agreementData: testAgreementDataSchema.required(),
}).label("TestAgreementResponse");
