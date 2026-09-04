import Boom from "@hapi/boom";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { config } from "../../common/config.js";
import { redriveConflict } from "../../common/event-redrive.js";
import { logger } from "../../common/logger.js";
import { buildAuditEvent, withAudit } from "../../common/with-audit.js";
import {
  findStatusById as gasInboxStatus,
  redriveById as redriveGasInbox,
} from "../../grants/repositories/inbox.repository.js";
import {
  findStatusById as gasOutboxStatus,
  redriveById as redriveGasOutbox,
} from "../../grants/repositories/outbox.repository.js";
import { redriveCwEvent } from "../repositories/cw-actuators.repository.js";
import {
  normaliseCwInbox,
  normaliseCwOutbox,
  normaliseGasInbox,
  normaliseGasOutbox,
  toEventRow,
} from "../services/map-event-row.js";

const GAS = "gas";
const CASEWORKING = "caseworking";

const GAS_BOXES = {
  inbox: {
    redrive: redriveGasInbox,
    status: gasInboxStatus,
    normalise: (doc) => normaliseGasInbox(doc, config.inbox.inboxMaxRetries),
  },
  outbox: {
    redrive: redriveGasOutbox,
    status: gasOutboxStatus,
    normalise: (doc) => normaliseGasOutbox(doc, config.outbox.outboxMaxRetries),
  },
};

// Caseworking pre-flattens its list rows, so its own list normalisers apply to
// what its redrive endpoint answers with.
const CW_BOXES = { inbox: normaliseCwInbox, outbox: normaliseCwOutbox };

// The update is the precondition: it matches only a DEAD_LETTER row, so a
// concurrent status change loses cleanly. Nothing matched means either the row
// is gone (404) or it is no longer DEAD_LETTER (409) - one extra read tells
// them apart, and only on the failure path.
const redriveGasEvent = async (box, id, actor) => {
  const source = GAS_BOXES[box];
  const doc = await source.redrive(id, { by: actor });

  if (doc) {
    return toEventRow({
      service: GAS,
      box,
      intermediate: source.normalise(doc),
    });
  }

  const status = await source.status(id);

  if (status === null) {
    throw Boom.notFound(`gas ${box} event "${id}" not found`);
  }

  throw redriveConflict(`gas ${box}`, id, status);
};

// 404 and 409 come back from Caseworking as themselves; anything else is a 502.
const redriveCaseworkingEvent = async (box, id, actor) => {
  const row = await redriveCwEvent(box, id, { by: actor });

  return toEventRow({
    service: CASEWORKING,
    box,
    intermediate: CW_BOXES[box](row),
  });
};

const redriveEvent = async ({ service, box, id, actor }) => {
  logger.info(`Redrive event ${service}/${box}/${id}`);

  const event =
    service === GAS
      ? await redriveGasEvent(box, id, actor)
      : await redriveCaseworkingEvent(box, id, actor);

  logger.info(
    `Finished: Redrive event ${service}/${box}/${id} (${event.status})`,
  );

  return { event };
};

// Redrive changes state, so who redrove what is audited. A 404 or a 409 is
// audited as a FAILURE by `withAudit` - a refused redrive is still an attempt.
//
// `actor` is the operator named in the `x-actor` header; `caller` is the
// authenticated service client. Both are recorded, because they answer
// different questions, and `actor` is persisted on the row as `lastRedrive.by`
// as well so the detail view can answer "who redrove this?" without a search
// through the audit log.
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

export const redriveEventUseCase = withAudit(
  redriveEvent,
  redriveEventAuditBuilder,
);
