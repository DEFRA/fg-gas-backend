import Boom from "@hapi/boom";
import { auditActions, auditEntities } from "../../events/audit-constants.js";
import { logger } from "../../common/logger.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import { withTransaction } from "../../common/with-transaction.js";
import { redriveConflict } from "../../events/event-redrive.js";
import {
  findStatusById as gasInboxStatus,
  redriveById as redriveGasInbox,
} from "../../events/repositories/inbox.repository.js";
import {
  findStatusById as gasOutboxStatus,
  redriveById as redriveGasOutbox,
} from "../../events/repositories/outbox.repository.js";
import { redriveCwEvent } from "../repositories/cw-actuators.repository.js";
import { withStatusLabel } from "../services/cw-conflict.js";
import { statusDisplay } from "../services/event-display.js";
import { GAS } from "../services/event-sources.js";

const GAS_BOXES = {
  inbox: { redrive: redriveGasInbox, status: gasInboxStatus },
  outbox: { redrive: redriveGasOutbox, status: gasOutboxStatus },
};

// Nothing matched: one extra read tells a missing row (404) from a moved one (409).
const redriveGasEvent = async (box, id, actor, session) => {
  const source = GAS_BOXES[box];
  if (await source.redrive(id, { by: actor, session })) {
    return;
  }

  const status = await source.status(id, session);

  if (status === null) {
    throw Boom.notFound(`gas ${box} event "${id}" not found`);
  }

  throw redriveConflict(
    `gas ${box}`,
    id,
    status,
    statusDisplay(status).statusLabel,
  );
};

const redriveCaseworkingEvent = async (box, id, actor) => {
  await redriveCwEvent(box, id, { by: actor }).catch(withStatusLabel);
};

const redriveEvent = async ({ service, box, id, actor }, session) => {
  logger.info(`Redrive event ${service}/${box}/${id}`);

  if (service === GAS) {
    await redriveGasEvent(box, id, actor, session);
  } else {
    await redriveCaseworkingEvent(box, id, actor);
  }

  logger.info(`Finished: Redrive event ${service}/${box}/${id}`);
};

// A refused redrive is still audited, as a FAILURE.
export const redriveEventAuditBuilder = ([
  { service, box, id, caller, actor },
]) =>
  buildAuditEvent({
    entity: auditEntities.EVENT,
    action: auditActions.REDRIVE_EVENT,
    entityid: id,
    details: { service, box, caller, actor: actor ?? null },
    segregationRef: `event-${id}`,
  });

const redriveEventWithAudit = withAudit(redriveEvent, redriveEventAuditBuilder);

// GAS: the row and its audit event commit together. Caseworking cannot join a
// Mongo transaction, so its redrive stays best-effort.
export const redriveEventUseCase = async (params) =>
  params.service === GAS
    ? withTransaction((session) => redriveEventWithAudit(params, session))
    : redriveEventWithAudit(params);
