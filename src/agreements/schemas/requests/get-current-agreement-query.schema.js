import Joi from "joi";

const agreementPresentationQuerySchema = Joi.object({
  mode: Joi.string().valid("view", "print").default("view"),
}).label("AgreementPresentationQuery");

export const getCurrentAgreementQuerySchema =
  agreementPresentationQuerySchema.label("GetCurrentAgreementQuery");

export const getAgreementDocumentQuerySchema = Joi.object({}).label(
  "GetAgreementDocumentQuery",
);
