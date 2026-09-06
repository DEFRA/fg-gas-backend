import { createEntitlementRoute } from "./routes/create-entitlement.route.js";
import { getClaimRoute } from "./routes/get-claim.route.js";
import { getClaimsRoute } from "./routes/get-claims.route.js";

export const grantAdmin = {
  name: "grant-admin",
  register(server) {
    server.route([getClaimsRoute, getClaimRoute, createEntitlementRoute]);
  },
};
