import { logger } from "../../common/logger.js";
import { eventDetailPageResponseSchema } from "../schemas/event-detail-response.schema.js";
import { eventParamsSchema } from "../schemas/event-params.schema.js";
import { callerOf } from "../services/request-caller.js";
import { eventDetailPageUseCase } from "../use-cases/event-detail-page.use-case.js";

// No `auth` option: the default `service` strategy applies, so a request with
// no or an invalid bearer token is a 401 before the handler runs.
export const getEventRoute = {
  method: "GET",
  path: "/grant-admin/events/{service}/{box}/{id}",
  options: {
    description:
      "Admin: one GAS or Caseworking event in full - its stored payload, and every hop carrying its event id",
    tags: ["api"],
    validate: { params: eventParamsSchema },
    response: { schema: eventDetailPageResponseSchema },
  },
  async handler(request) {
    const { service, box, id } = request.params;

    const event = await eventDetailPageUseCase({
      service,
      box,
      id,
      caller: callerOf(request),
    });

    logger.info(`Finished: Get event ${service}/${box}/${id}`);

    return event;
  },
};
