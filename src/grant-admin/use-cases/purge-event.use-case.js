import Boom from "@hapi/boom";
import { auditActions, auditEntities } from "../../events/audit-constants.js";
import { logger } from "../../common/logger.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import { withTransaction } from "../../common/with-transaction.js";
import {
  findStatusById as gasInboxStatus,
  purgeById as purgeGasInbox,
} from "../../events/repositories/inbox.repository.js";
import {
  findStatusById as gasOutboxStatus,
  purgeById as purgeGasOutbox,
} from "../../events/repositories/outbox.repository.js";
import {
  findCwEvent,
  purgeCwEvent,
} from "../repositories/cw-actuators.repository.js";
import { statusOf } from "../repositories/cw-http.js";
import { statusDisplay } from "../services/event-display.js";
import { GAS } from "../services/event-sources.js";

const GAS_BOXES = {
  inbox: { purge: purgeGasInbox, status: gasInboxStatus },
  outbox: { purge: purgeGasOutbox, status: gasOutboxStatus },
};

export const NOT_PURGEABLE = "NOT_PURGEABLE";

const CONFLICT = 409;
const NOT_FOUND = 404;

// Purgeable is what the event page offers: dead-lettered, with a deletion
// date. Any other event that exists is refused in one shape, naming no value
// the request sent.
const notPurgeable = (status) => {
  const error = Boom.conflict("The event is not purgeable");

  error.output.payload = {
    ...error.output.payload,
    code: NOT_PURGEABLE,
    status,
    statusLabel: status ? statusDisplay(status).statusLabel : null,
  };

  return error;
};

// Nothing matched: one extra read tells a missing row (404) from a moved one
// (409), exactly as a refused redrive does.
const purgeGasEvent = async (box, id, { actor, reasonCode, note }, session) => {
  const source = GAS_BOXES[box];

  if (await source.purge(id, { by: actor, reasonCode, note, session })) {
    return;
  }

  const status = await source.status(id, session);

  if (status === null) {
    throw Boom.notFound(`gas ${box} event "${id}" not found`);
  }

  throw notPurgeable(status);
};

// A Caseworking without a purge endpoint answers a bare 404 for an event it
// holds, so a 404 reads the event to tell a missing one from one it cannot
// purge.
const statusIfFound = async (box, id) => {
  try {
    return (await findCwEvent(box, id)).status ?? null;
  } catch {
    return undefined;
  }
};

const missingOrNotPurgeable = async (box, id, error) => {
  const status = await statusIfFound(box, id);

  return status === undefined ? error : notPurgeable(status);
};

const conflictOf = (_box, _id, error) =>
  notPurgeable(error.output.payload?.status ?? null);

const CW_REFUSALS = {
  [CONFLICT]: conflictOf,
  [NOT_FOUND]: missingOrNotPurgeable,
};

const toPurgeRefusal = (box, id, error) =>
  (CW_REFUSALS[statusOf(error)] ?? ((_b, _i, same) => same))(box, id, error);

const purgeCaseworkingEvent = async (box, id, { actor, reasonCode, note }) => {
  try {
    await purgeCwEvent(box, id, { by: actor, reasonCode, note });
  } catch (error) {
    throw await toPurgeRefusal(box, id, error);
  }
};

const purgeEvent = async (
  { service, box, id, actor, reasonCode, note },
  session,
) => {
  logger.info(`Purge event ${service}/${box}/${id} as ${reasonCode}`);

  if (service === GAS) {
    await purgeGasEvent(box, id, { actor, reasonCode, note }, session);
  } else {
    await purgeCaseworkingEvent(box, id, { actor, reasonCode, note });
  }

  logger.info(`Finished: Purge event ${service}/${box}/${id}`);
};

// A refused purge is still audited, as a FAILURE. The reason code travels; the
// note does not, being free text that can name whoever the operator wrote
// about. The row keeps the note until the row is deleted.
const purgeEventAuditBuilder = ([
  { service, box, id, caller, actor, reasonCode },
]) =>
  buildAuditEvent({
    entity: auditEntities.EVENT,
    action: auditActions.PURGE_EVENT,
    entityid: id,
    details: { service, box, caller, actor: actor ?? null, reasonCode },
    segregationRef: `event-${id}`,
  });

const purgeEventWithAudit = withAudit(purgeEvent, purgeEventAuditBuilder);

// GAS: the row and its audit event commit together, so a purge is never
// recorded without happening. Caseworking cannot join a Mongo transaction, and
// audits the change it makes itself.
export const purgeEventUseCase = async (params) =>
  params.service === GAS
    ? withTransaction((session) => purgeEventWithAudit(params, session))
    : purgeEventWithAudit(params);
