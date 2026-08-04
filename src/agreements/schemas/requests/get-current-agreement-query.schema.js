import Joi from "joi";
import { clientRef } from "../agreement/client-ref.js";
import { code } from "../agreement/code.js";
import { sbi } from "../agreement/sbi.js";

const agreementIdentityQueryFields = {
  code: code.required(),
  clientRef: clientRef.required(),
  sbi: sbi.required(),
};

const agreementPresentationQuerySchema = Joi.object({
  mode: Joi.string().valid("view", "print").default("view"),
}).label("AgreementPresentationQuery");

export const getAgreementDocumentQuerySchema = Joi.object(
  agreementIdentityQueryFields,
).label("GetAgreementDocumentQuery");

export const getCurrentAgreementQuerySchema = agreementPresentationQuerySchema
  .keys(agreementIdentityQueryFields)
  .label("GetCurrentAgreementQuery");
