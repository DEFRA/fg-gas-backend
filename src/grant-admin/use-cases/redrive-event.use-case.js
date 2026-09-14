import Boom from "@hapi/boom";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { buildAuditEvent, withAudit } from "../../common/with-audit.js";
import { withTransaction } from "../../common/with-transaction.js";
import { redriveConflict } from "../../events/event-redrive.js";
import {
  findStatusById as gasInboxStatus,
  redriveById as redriveGasInbox,
} from "../../grants/repositories/inbox.repository.js";
import {
  findStatusById as gasOutboxStatus,
  redriveById as redriveGasOutbox,
} from "../../grants/repositories/outbox.repository.js";
import { redriveCwEvent } from "../repositories/cw-actuators.repository.js";
import { statusDisplay } from "../services/event-display.js";
import { CASEWORKING, GAS } from "../services/event-sources.js";
import {
  normaliseCwInbox,
  normaliseCwOutbox,
  normaliseGasInbox,
  normaliseGasOutbox,
  toEventRow,
} from "../services/map-event-row.js";

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
const redriveGasEvent = async (box, id, actor, session) => {
  const source = GAS_BOXES[box];
  const doc = await source.redrive(id, { by: actor, session });

  if (doc) {
    return toEventRow({
      service: GAS,
      box,
      intermediate: source.normalise(doc),
    });
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

// A refused Caseworking redrive comes back as itself - a 404 or a 409 with the
// status that blocked it - and gains the words that status is spelled in on
// the way through, exactly as a GAS conflict does. Caseworking states what its
// row is; how this platform's admin surface says it is this service's to
// answer, and it is answered in one place for both services.
const conflictPayload = (error) => error.output?.payload;

const withStatusLabel = (error) => {
  const payload = conflictPayload(error) ?? {};

  if (payload.status) {
    payload.statusLabel = statusDisplay(payload.status).statusLabel;
  }

  throw error;
};

const redriveCaseworkingEvent = async (box, id, actor) => {
  const row = await redriveCwEvent(box, id, { by: actor }).catch(
    withStatusLabel,
  );

  return toEventRow({
    service: CASEWORKING,
    box,
    intermediate: CW_BOXES[box](row),
  });
};

// `session` is `withAudit`'s second argument, so the audit event's own outbox
// insert joins whatever transaction the caller opened. GAS rows get one;
// Caseworking rows cannot - see `redriveEventUseCase`.
const redriveEvent = async ({ service, box, id, actor }, session) => {
  logger.info(`Redrive event ${service}/${box}/${id}`);

  const event =
    service === GAS
      ? await redriveGasEvent(box, id, actor, session)
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

const redriveEventWithAudit = withAudit(redriveEvent, redriveEventAuditBuilder);

/**
 * A GAS redrive and its audit event commit together or not at all.
 *
 * The audit is not a publish - `writeAuditEvent` inserts it into THIS
 * service's own outbox collection, in the same database as the row being
 * redriven - so one Mongo transaction can cover both. `withTransaction` opens
 * it, `withAudit` passes the session on as its second argument, and the
 * repository's `findOneAndUpdate` and the outbox `insertMany` both join it. If
 * the audit insert fails, `withAudit` rethrows rather than swallowing and the
 * transaction aborts: the row stays DEAD_LETTER and the caller gets an error,
 * instead of a redrive nobody can prove happened.
 *
 * A CASEWORKING redrive is deliberately NOT transactional and stays
 * best-effort. The action is an HTTP call to another service, and no Mongo
 * transaction can span that: aborting here would roll back this service's
 * audit while Caseworking's row stayed redriven, which is a worse lie than the
 * one it would be fixing. Caseworking records its own `lastRedrive` on the row
 * and logs the redrive; a failed audit write there is logged and swallowed,
 * exactly as before.
 */
export const redriveEventUseCase = async (params) =>
  params.service === GAS
    ? withTransaction((session) => redriveEventWithAudit(params, session))
    : redriveEventWithAudit(params);
