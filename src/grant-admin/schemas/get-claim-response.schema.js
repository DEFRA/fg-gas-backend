import {
  availableEntitlement,
  getClaimsResponseSchema,
} from "./get-claims-response.schema.js";

export const getClaimResponseSchema = getClaimsResponseSchema.keys({
  entitlementTemplate: availableEntitlement.required(),
});
