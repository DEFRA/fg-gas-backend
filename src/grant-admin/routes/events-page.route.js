import { eventsPageQuerySchema } from "../schemas/events-page-query.schema.js";
import { eventsPageResponseSchema } from "../schemas/events-page-response.schema.js";
import { eventsPageUseCase } from "../use-cases/events-page.use-case.js";

// No `auth` option: the default `service` strategy applies, so a request with
// no or an invalid bearer token is a 401 before the handler runs.
//
// One segment after /events, so it can never collide with the three-segment
// /events/{service}/{box}/{id} detail route.
export const eventsPageRoute = {
  method: "GET",
  path: "/grant-admin/events/page",
  options: {
    description:
      "Admin: the whole events page - the merged list, the status counts and the dead-letter breakdown - in one read",
    tags: ["api"],
    validate: { query: eventsPageQuerySchema },
    response: { schema: eventsPageResponseSchema },
  },
  async handler(request) {
    const { cursor, direction, status, service, q, error, from, to, audit } =
      request.query;

    return eventsPageUseCase({
      cursor,
      direction,
      status,
      service,
      q,
      error,
      from,
      to,
      audit,
    });
  },
};
