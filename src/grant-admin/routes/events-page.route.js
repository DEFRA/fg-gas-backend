import { eventsPageQuerySchema } from "../schemas/events-page-query.schema.js";
import { eventsPageResponseSchema } from "../schemas/events-page-response.schema.js";
import { eventsPageUseCase } from "../use-cases/events-page.use-case.js";

// One segment after /events, so it can never collide with the detail route.
export const eventsPageRoute = {
  method: "GET",
  path: "/grant-admin/events/page",
  options: {
    description:
      "Admin: the events page in one read - the merged list, and the status counts and dead-letter breakdown when the page draws them",
    tags: ["api"],
    validate: { query: eventsPageQuerySchema },
    response: { schema: eventsPageResponseSchema },
  },
  async handler(request) {
    const { cursor, status, service, q, error, from, to, audit } =
      request.query;

    return eventsPageUseCase({
      cursor,
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
