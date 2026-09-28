import Boom from "@hapi/boom";
import { auditActions, auditEntities } from "../../events/audit-constants.js";
import { logger } from "../../common/logger.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import { withTransaction } from "../../common/with-transaction.js";
import { purgeConflict } from "../../events/event-purge.js";
import {
  findStatusById as gasInboxStatus,
  purgeById as purgeGasInbox,
} from "../../events/repositories/inbox.repository.js";
import {
  findStatusById as gasOutboxStatus,
  purgeById as purgeGasOutbox,
} from "../../events/repositories/outbox.repository.js";
import { purgeCwEvent } from "../repositories/cw-actuators.repository.js";
import { withStatusLabel } from "../services/cw-conflict.js";
import { statusDisplay } from "../services/event-display.js";
import { GAS } from "../services/event-sources.js";

const GAS_BOXES = {
  inbox: { purge: purgeGasInbox, status: gasInboxStatus },
  outbox: { purge: purgeGasOutbox, status: gasOutboxStatus },
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

  throw purgeConflict(
    `gas ${box}`,
    id,
    status,
    statusDisplay(status).statusLabel,
  );
};

const purgeCaseworkingEvent = async (box, id, { actor, reasonCode, note }) => {
  await purgeCwEvent(box, id, { by: actor, reasonCode, note }).catch(
    withStatusLabel,
  );
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
