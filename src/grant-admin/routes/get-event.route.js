import { logger } from "../../common/logger.js";
import { eventDetailResponseSchema } from "../schemas/event-detail-response.schema.js";
import { eventParamsSchema } from "../schemas/event-params.schema.js";
import { callerOf } from "../services/request-caller.js";
import { getEventUseCase } from "../use-cases/get-event.use-case.js";

export const getEventRoute = {
  method: "GET",
  path: "/grant-admin/events/{service}/{box}/{id}",
  options: {
    description:
      "Admin: one GAS or Caseworking event in full, its stored payload included",
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
