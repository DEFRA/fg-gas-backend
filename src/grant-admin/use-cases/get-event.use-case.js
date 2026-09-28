import Boom from "@hapi/boom";
import { auditActions, auditEntities } from "../../events/audit-constants.js";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import { findById as findGasInboxById } from "../../events/repositories/inbox.repository.js";
import { findById as findGasOutboxById } from "../../events/repositories/outbox.repository.js";
import { findCwEvent } from "../repositories/cw-actuators.repository.js";
import { CASEWORKING, GAS } from "../services/event-sources.js";
import { toEventDetail } from "../services/map-event-detail.js";

const GAS_BOXES = {
  inbox: {
    find: findGasInboxById,
    maxAttempts: () => config.inbox.inboxMaxRetries,
  },
  outbox: {
    find: findGasOutboxById,
    maxAttempts: () => config.outbox.outboxMaxRetries,
  },
};

const getGasEvent = async (box, id) => {
  const doc = await GAS_BOXES[box].find(id);

  if (!doc) {
    throw Boom.notFound(`gas ${box} event "${id}" not found`);
  }

  return toEventDetail({
    service: GAS,
    box,
    doc,
    maxAttempts: GAS_BOXES[box].maxAttempts(),
    retentionDays: config.events.retentionDays,
  });
};

// No partial mode: half a detail view is not a view.
const getCwEvent = async (box, id) => {
  const doc = await findCwEvent(box, id);

  return toEventDetail({
    service: CASEWORKING,
    box,
    doc,
    maxAttempts: doc.maxAttempts,
  });
};

const getEvent = ({ service, box, id }) => {
  logger.info(`Get event ${service}/${box}/${id}`);

  return service === GAS ? getGasEvent(box, id) : getCwEvent(box, id);
};

// Reading an event reads its payload, so every access is audited.
export const getEventAuditBuilder = ([{ service, box, id, caller }]) =>
  buildAuditEvent({
    entity: auditEntities.EVENT,
    action: auditActions.VIEW_EVENT,
    entityid: id,
    details: { service, box, caller },
    segregationRef: `event-${id}`,
  });

export const getEventUseCase = withAudit(getEvent, getEventAuditBuilder);
