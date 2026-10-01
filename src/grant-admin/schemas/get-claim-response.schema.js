import {
  applicationClaimsSchema,
  availableEntitlement,
} from "./get-claims-response.schema.js";

export const getClaimResponseSchema = applicationClaimsSchema.keys({
  entitlementTemplate: availableEntitlement.required(),
});
