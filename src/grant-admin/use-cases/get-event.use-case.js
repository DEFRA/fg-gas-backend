import Boom from "@hapi/boom";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { buildAuditEvent, withAudit } from "../../common/with-audit.js";
import { findById as findGasInboxById } from "../../grants/repositories/inbox.repository.js";
import { findById as findGasOutboxById } from "../../grants/repositories/outbox.repository.js";
import { findCwEvent } from "../repositories/cw-actuators.repository.js";
import { CASEWORKING, GAS } from "../services/event-sources.js";
import { toEventDetail } from "../services/map-event-detail.js";

// Each service knows its own retry cap: GAS reads its config, Caseworking
// returns `maxAttempts` on the document it answers with.
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

// The event, and this service's Caseworking hops of its journey where the
// answer already carried them.
//
// A GAS event's hops are two Mongo reads and a Caseworking read the page still
// has to make; a Caseworking event's came back with the event itself, because
// nothing knows which id to search for until the detail has answered and
// Caseworking answers both in one request. `cwHops` is how the page avoids
// asking for them a second time.
const getGasEvent = async (box, id) => {
  const doc = await GAS_BOXES[box].find(id);

  if (!doc) {
    throw Boom.notFound(`gas ${box} event "${id}" not found`);
  }

  return {
    event: toEventDetail({
      service: GAS,
      box,
      doc,
      maxAttempts: GAS_BOXES[box].maxAttempts(),
    }),
    cwHops: null,
  };
};

// No partial mode here: the repository turns a 404 into a 404 and every other
// Caseworking failure into a 502, because half a detail view is not a view.
const getCwEvent = async (box, id) => {
  const doc = await findCwEvent(box, id);

  return {
    event: toEventDetail({
      service: CASEWORKING,
      box,
      doc,
      maxAttempts: doc.maxAttempts,
    }),
    // Both of Caseworking's boxes, already searched for this event's id.
    cwHops: doc.hops ?? null,
  };
};

const getEvent = ({ service, box, id }) => {
  logger.info(`Get event ${service}/${box}/${id}`);

  return service === GAS ? getGasEvent(box, id) : getCwEvent(box, id);
};

// Reading one event means reading its payload, so every access is audited -
// who asked, for which service, box and id, and whether they got it. A 404 or
// a 502 is audited as a FAILURE by `withAudit` rather than going unrecorded.
export const getEventAuditBuilder = ([{ service, box, id, caller }]) =>
  buildAuditEvent({
    entity: auditEntities.EVENT,
    action: auditActions.VIEW_EVENT,
    entityid: id,
    details: { service, box, caller },
    segregationRef: `event-${id}`,
  });

export const getEventUseCase = withAudit(getEvent, getEventAuditBuilder);
