import Joi from "joi";
import { entitlementTemplates } from "../../grants/schemas/grant/entitlement-template.js";

// One labelled field of the page header, carrying a value ready to render. The
// type travels with it so a value keeps its own - a number stays a number
// rather than being stringified here.
const resolvedText = Joi.alternatives().try(
  Joi.string().allow(""),
  Joi.number(),
  Joi.boolean(),
  Joi.date(),
);

const bannerField = Joi.object({
  label: Joi.string(),
  text: resolvedText.required(),
  type: Joi.string().required(),
  format: Joi.string().optional(),
});

// A field an application has no value for is left out rather than shown empty,
// so a caller reads what is present rather than checking each one.
const banner = Joi.object({
  title: bannerField.optional(),
  summary: Joi.object().pattern(Joi.string(), bannerField).optional(),
}).label("ClaimsPageBanner");

// claimableEntitlements and claims are stubbed as empty by the use case until entitlement instances are written, so neither has a shape to pin down yet.
export const getClaimsResponseSchema = Joi.object({
  banner: banner.optional(),
  availableEntitlements: entitlementTemplates,
  claimableEntitlements: Joi.array(),
  claims: Joi.array(),
});
