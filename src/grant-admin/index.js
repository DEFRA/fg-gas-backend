import { breakdownEventsRoute } from "./routes/breakdown-events.route.js";
import { countEventsRoute } from "./routes/count-events.route.js";
import { findEventsRoute } from "./routes/find-events.route.js";
import { getClaimsRoute } from "./routes/get-claims.route.js";
import { getEventRoute } from "./routes/get-event.route.js";
import { parkEventRoute } from "./routes/park-event.route.js";
import { redriveEventRoute } from "./routes/redrive-event.route.js";
import { redriveQueryRoute } from "./routes/redrive-query.route.js";
import { unparkEventRoute } from "./routes/unpark-event.route.js";

export const grantAdmin = {
  name: "grant-admin",
  register(server) {
    // The single-segment routes (`/counts`, `/breakdown`, `/redrive-query`)
    // are registered before the three-segment `/{service}/{box}/{id}` ones.
    // They cannot collide - the segment counts differ - but the order keeps
    // the list readable, and index.test.js asserts each path reaches the route
    // it names.
    server.route([
      getClaimsRoute,
      findEventsRoute,
      countEventsRoute,
      breakdownEventsRoute,
      redriveQueryRoute,
      getEventRoute,
      redriveEventRoute,
      parkEventRoute,
      unparkEventRoute,
    ]);
  },
};
