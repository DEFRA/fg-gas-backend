import { logger } from "../../common/logger.js";
import { eventDetailResponseSchema } from "../schemas/event-detail-response.schema.js";
import { eventParamsSchema } from "../schemas/event-params.schema.js";
import { getEventUseCase } from "../use-cases/get-event.use-case.js";

// The authenticated service client, recorded on the audit event alongside the
// service/box/id. Null only if the strategy ever stops populating credentials.
const callerOf = (request) => request.auth?.credentials?.service ?? null;

// No `auth` option: the default `service` strategy applies, so a request with
// no or an invalid bearer token is a 401 before the handler runs.
export const getEventRoute = {
  method: "GET",
  path: "/grant-admin/events/{service}/{box}/{id}",
  options: {
    description:
      "Admin: one GAS or Caseworking event in full, including its stored payload",
    tags: ["api"],
    validate: { params: eventParamsSchema },
    response: { schema: eventDetailResponseSchema },
  },
  async handler(request) {
    const { service, box, id } = request.params;

    const event = await getEventUseCase({
      service,
      box,
      id,
      caller: callerOf(request),
    });

    logger.info(`Finished: Get event ${service}/${box}/${id}`);

    return event;
  },
};
