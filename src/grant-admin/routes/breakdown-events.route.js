import { logger } from "../../common/logger.js";
import { breakdownEventsQuerySchema } from "../schemas/breakdown-events-query.schema.js";
import { breakdownEventsResponseSchema } from "../schemas/breakdown-events-response.schema.js";
import { breakdownEventsUseCase } from "../use-cases/breakdown-events.use-case.js";

// No `auth` option: the default `service` strategy applies, so a request with
// no or an invalid bearer token is a 401 before the handler runs.
//
// One segment after /events, so it can never collide with the three-segment
// /events/{service}/{box}/{id} detail route.
export const breakdownEventsRoute = {
  method: "GET",
  path: "/grant-admin/events/breakdown",
  options: {
    description:
      "Admin: group DEAD_LETTER events across GAS and Caseworking by failure message and event type, commonest first",
    tags: ["api"],
    validate: { query: breakdownEventsQuerySchema },
    response: { schema: breakdownEventsResponseSchema },
  },
  async handler(request) {
    const { service, q, from, to } = request.query;

    const result = await breakdownEventsUseCase({ service, q, from, to });

    logger.info(`Finished: Breakdown events (${result.groups.length} groups)`);

    return result;
  },
};
