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
    const { cursor, direction, status, service, q, error, from, to, audit } =
      request.query;

    const { events, pagination, sourceErrors } = await findEventsUseCase({
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

    // Named rather than returned whole: the use case also answers with the
    // journey's shape of this same page, which the detail page reads and this
    // endpoint has no use for. The response schema is closed, so returning it
    // would fail validation rather than merely oversharing.
    return { events, pagination, sourceErrors };
  },
};
