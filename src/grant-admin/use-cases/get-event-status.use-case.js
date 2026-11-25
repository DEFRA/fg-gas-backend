import Boom from "@hapi/boom";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { findProgressById as findGasInboxProgress } from "../../events/repositories/inbox.repository.js";
import { findProgressById as findGasOutboxProgress } from "../../events/repositories/outbox.repository.js";
import { findCwEventStatus } from "../repositories/cw-actuators.repository.js";
import { statusDisplay } from "../services/event-display.js";
import { GAS } from "../services/event-sources.js";

const GAS_BOXES = {
  inbox: {
    find: findGasInboxProgress,
    maxAttempts: () => config.inbox.inboxMaxRetries,
  },
  outbox: {
    find: findGasOutboxProgress,
    maxAttempts: () => config.outbox.outboxMaxRetries,
  },
};

// A redrive resets the count, so it is the attempts since the last one.
const toEventStatus = ({ status, completionAttempts }, maxAttempts) => ({
  status,
  statusLabel: statusDisplay(status).statusLabel,
  attemptsSinceRedrive: completionAttempts ?? 0,
  maxAttempts,
});

const getGasEventStatus = async (box, id) => {
  const doc = await GAS_BOXES[box].find(id);

  if (!doc) {
    throw Boom.notFound(`gas ${box} event "${id}" not found`);
  }

  return toEventStatus(doc, GAS_BOXES[box].maxAttempts());
};

const getCwEventStatus = async (box, id) => {
  const found = await findCwEventStatus(box, id);

  return toEventStatus(found, found.maxAttempts);
};

// Not audited: it reads no payload, as the lists that show a status do not.
export const getEventStatusUseCase = ({ service, box, id }) => {
  logger.info(`Get event status ${service}/${box}/${id}`);

  return service === GAS
    ? getGasEventStatus(box, id)
    : getCwEventStatus(box, id);
};
