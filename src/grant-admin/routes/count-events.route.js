import { logger } from "../../common/logger.js";
import { countEventsQuerySchema } from "../schemas/count-events-query.schema.js";
import { countEventsResponseSchema } from "../schemas/count-events-response.schema.js";
import { countEventsUseCase } from "../use-cases/count-events.use-case.js";

// No `auth` option: the default `service` strategy applies, so a request with
// no or an invalid bearer token is a 401 before the handler runs.
//
// One segment after /events, so it can never collide with the three-segment
// /events/{service}/{box}/{id} detail route.
export const countEventsRoute = {
  method: "GET",
  path: "/grant-admin/events/counts",
  options: {
    description:
      "Admin: how many merged GAS and Caseworking events sit in each status",
    tags: ["api"],
    validate: { query: countEventsQuerySchema },
    response: { schema: countEventsResponseSchema },
  },
  async handler(request) {
    const { service, q, error, from, to } = request.query;

    const result = await countEventsUseCase({
      service,
      q,
      error,
      from,
      to,
    });

    logger.info("Finished: Count events");

    return result;
  },
};
