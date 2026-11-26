import { logger } from "../../common/logger.js";
import { eventParamsSchema } from "../schemas/event-params.schema.js";
import { eventStatusResponseSchema } from "../schemas/event-status-response.schema.js";
import { getEventStatusUseCase } from "../use-cases/get-event-status.use-case.js";

export const getEventStatusRoute = {
  method: "GET",
  path: "/grant-admin/events/{service}/{box}/{id}/status",
  options: {
    description:
      "Admin: one GAS or Caseworking event's status and the attempts since its last redrive, without its payload",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: { params: eventParamsSchema },
    response: { schema: eventStatusResponseSchema },
  },
  async handler(request) {
    const { service, box, id } = request.params;

    const status = await getEventStatusUseCase({ service, box, id });

    logger.info(`Finished: Get event status ${service}/${box}/${id}`);

    return status;
  },
};
