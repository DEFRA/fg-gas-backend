import { entitlementTemplate } from "../../grants/schemas/grant/entitlement-template.js";
import { getClaimsResponseSchema } from "./get-claims-response.schema.js";

export const getClaimResponseSchema = getClaimsResponseSchema.keys({
  entitlementTemplate: entitlementTemplate.required(),
});
