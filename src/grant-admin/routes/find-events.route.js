import { logger } from "../../common/logger.js";
import { findEventsQuerySchema } from "../schemas/find-events-query.schema.js";
import { findEventsResponseSchema } from "../schemas/find-events-response.schema.js";
import { findEventsUseCase } from "../use-cases/find-events.use-case.js";

// No `auth` option: the default `service` strategy applies, so a request with
// no or an invalid bearer token is a 401 before the handler runs.
export const findEventsRoute = {
  method: "GET",
  path: "/grant-admin/events",
  options: {
    description:
      "Admin: merged GAS and Caseworking inbox/outbox events, newest first",
    tags: ["api"],
    validate: { query: findEventsQuerySchema },
    response: { schema: findEventsResponseSchema },
  },
  async handler(request) {
    const { cursor, direction, status, service } = request.query;

    logger.info(`Find events (direction ${direction})`);

    const page = await findEventsUseCase({
      cursor,
      direction,
      status,
      service,
    });

    logger.info(`Finished: Find events (${page.events.length} rows)`);

    return page;
  },
};
