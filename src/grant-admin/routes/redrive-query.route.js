import { actorHeaderSchema } from "../schemas/find-events-query.schema.js";
import { redriveQueryResponseSchema } from "../schemas/redrive-query-response.schema.js";
import { redriveQuerySchema } from "../schemas/redrive-query.schema.js";
import { redriveQueryUseCase } from "../use-cases/redrive-query.use-case.js";

const callerOf = (request) => request.auth?.credentials?.service ?? null;

// The operator this mutation is made on behalf of, as a header rather than a
// body key so every mutation route takes it the same way and a body-less POST
// still carries it. Validated by `actorHeaderSchema`, so an over-long value is
// a 400 rather than something written into an audit event and onto a document.
const actorOf = (request) => request.headers["x-actor"] ?? null;

// Accepts the filter as a body OR as a query string - the same keys either
// way. A bulk redrive is most often fired from a link the operator is already
// looking at (the list, with its filter in the URL), and forcing that into a
// JSON body would mean the frontend rebuilding a filter it already has.
const filterOf = (request) => ({ ...request.query, ...request.payload });

// No `auth` option: the default `service` strategy applies, so a request with
// no or an invalid bearer token is a 401 before the handler runs.
//
// One segment after /events, so it can never collide with the three-segment
// /events/{service}/{box}/{id} detail route.
export const redriveQueryRoute = {
  method: "POST",
  path: "/grant-admin/events/redrive-query",
  options: {
    description:
      "Admin: redrive every DEAD_LETTER event a filter selects, up to `limit`. Reports how many matched as well as how many were attempted.",
    tags: ["api"],
    validate: {
      headers: actorHeaderSchema,
      query: redriveQuerySchema,
      // `allow(null)`: a POST with no body at all is the common case - the
      // filter usually arrives as a query string - and hapi hands the handler
      // a null payload for it, which a bare object schema would reject as a
      // 400 before anything ran.
      payload: redriveQuerySchema.allow(null).optional(),
    },
    response: { schema: redriveQueryResponseSchema },
  },
  handler(request) {
    return redriveQueryUseCase({
      ...filterOf(request),
      caller: callerOf(request),
      actor: actorOf(request),
    });
  },
};
