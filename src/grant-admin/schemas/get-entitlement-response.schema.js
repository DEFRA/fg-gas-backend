import {
  availableEntitlement,
  claimableEntitlement,
  getClaimsResponseSchema,
} from "./get-claims-response.schema.js";

export const getEntitlementResponseSchema = getClaimsResponseSchema.keys({
  claimableEntitlement: claimableEntitlement.required(),
  entitlementTemplate: availableEntitlement.required(),
});
