import Joi from "joi";

// One labelled field of the page header: the label and type the grant
// configured, with the reference in "text" replaced by what it pointed at. A
// lone reference keeps its type, so a number stays a number rather than being
// stringified here.
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

// A field whose reference could not be resolved is left out rather than shown
// empty. The banner itself is always present: a grant that configures none has
// no claims page, which is answered with a 404.
const banner = Joi.object({
  title: bannerField.optional(),
  summary: Joi.object().pattern(Joi.string(), bannerField).optional(),
}).label("ClaimsPageBanner");

// An available template as answered here: the grant definition's template plus
// how many entitlements already exist against it.
const entitlementTemplate = Joi.object({
  claimCode: Joi.string().required(),
  name: Joi.string().required(),
  description: Joi.string().allow(null),
  materialised: Joi.boolean().required(),
  fields: Joi.object().allow(null),
  maxEntitlements: Joi.number().integer().min(1).required(),
  availableAt: Joi.array().min(1).required(),
  help: Joi.object().allow(null),
  claim: Joi.object().allow(null),
}).unknown(false);

export const availableEntitlement = entitlementTemplate
  .keys({
    createdCount: Joi.number().integer().min(0).required(),
  })
  .label("AvailableEntitlement");

const availableEntitlements = Joi.array()
  .items(availableEntitlement)
  .unique("claimCode")
  .label("AvailableEntitlements");

const claimableEntitlement = Joi.object({
  source: Joi.string().valid("persisted").required(),
  code: Joi.string().required(),
  name: Joi.string().required(),
  description: Joi.string().allow(null).required(),
  data: Joi.object().unknown().required(),
  entitlementId: Joi.string().required(),
  instanceNumber: Joi.number().integer().min(1).required(),
  claim: Joi.object().unknown().required(),
}).label("ClaimableEntitlement");

export const getClaimsResponseSchema = Joi.object({
  banner: banner.required(),
  availableEntitlements,
  claimableEntitlements: Joi.array().items(claimableEntitlement).required(),
  claims: Joi.array(),
});
