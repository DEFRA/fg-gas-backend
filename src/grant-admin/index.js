import { findEventsRoute } from "./routes/find-events.route.js";
import { getClaimsRoute } from "./routes/get-claims.route.js";

export const grantAdmin = {
  name: "grant-admin",
  register(server) {
    server.route([getClaimsRoute, findEventsRoute]);
  },
};
