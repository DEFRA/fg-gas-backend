import Boom from "@hapi/boom";
import { auditActions, auditEntities } from "../../events/audit-constants.js";
import { logger } from "../../common/logger.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import { withTransaction } from "../../common/with-transaction.js";
import {
  EDIT_REFUSAL_REASONS,
  assertStorable,
  editConflict,
  editFailureReason,
  editRefusal,
  payloadRevisionOf,
  staleEdit,
} from "../../events/event-edit.js";
import { REDRIVABLE_STATUSES } from "../../events/event-redrive.js";
import { payloadChanges, payloadHash } from "../../events/payload-changes.js";
import {
  editPayloadById as editGasInbox,
  findEditableById as findEditableGasInbox,
  findStatusById as gasInboxStatus,
} from "../../events/repositories/inbox.repository.js";
import {
  editPayloadById as editGasOutbox,
  findEditableById as findEditableGasOutbox,
  findStatusById as gasOutboxStatus,
} from "../../events/repositories/outbox.repository.js";
import { editCwPayload } from "../repositories/cw-actuators.repository.js";
import { withStatusLabel } from "../services/cw-conflict.js";
import { statusDisplay } from "../services/event-display.js";
import { GAS } from "../services/event-sources.js";

const GAS_BOXES = {
  inbox: {
    find: findEditableGasInbox,
    edit: editGasInbox,
    status: gasInboxStatus,
  },
  outbox: {
    find: findEditableGasOutbox,
    edit: editGasOutbox,
    status: gasOutboxStatus,
  },
};

// A missing row is a 404 and one that cannot be edited a 409; a redrivable one
// that refused the write was edited, purged or redriven since.
const refusalFor = (box, id, status) => {
  if (status === null) {
    return Boom.notFound(`gas ${box} event "${id}" not found`);
  }

  if (!REDRIVABLE_STATUSES.includes(status)) {
    return editConflict(
      `gas ${box}`,
      id,
      status,
      statusDisplay(status).statusLabel,
    );
  }

  return staleEdit(`gas ${box}`, id);
};

const isEditable = (stored, revision) =>
  REDRIVABLE_STATUSES.includes(stored?.status) &&
  payloadRevisionOf(stored) === revision;

const findEditable = async (box, id, revision, session) => {
  const stored = await GAS_BOXES[box].find(id, session);

  if (!isEditable(stored, revision)) {
    throw refusalFor(box, id, stored?.status ?? null);
  }

  return stored;
};

const changesTo = (stored, payload) => {
  assertStorable(payload);

  const changes = payloadChanges(stored.event, payload);

  if (changes.changedPaths.length === 0) {
    throw editRefusal(EDIT_REFUSAL_REASONS.UNCHANGED);
  }

  return changes;
};

// Read first, in the transaction: the stored payload is what the changed paths
// and the kept original come from. The fenced write still decides a race.
const editGasEvent = async (box, id, edit, session) => {
  const { actor, payload, note, revision } = edit;
  const source = GAS_BOXES[box];
  const stored = await findEditable(box, id, revision, session);
  const changes = changesTo(stored, payload);
  const edited = await source.edit(id, {
    revision,
    event: payload,
    original: stored.lastEdit ? undefined : stored.event,
    by: actor,
    note,
    session,
  });

  if (!edited) {
    throw refusalFor(box, id, await source.status(id, session));
  }

  return {
    payloadRevision: revision + 1,
    ...changes,
    beforeHash: payloadHash(stored.event),
    afterHash: payloadHash(payload),
  };
};

// Caseworking answers with what it changed, and audits the change itself.
const editCaseworkingEvent = async (
  box,
  id,
  { actor, payload, note, revision },
) => {
  const { payloadRevision, changedPaths, changedPathsTruncated } =
    await editCwPayload(box, id, {
      by: actor,
      payload,
      note,
      revision,
    }).catch(withStatusLabel);

  return { payloadRevision, changedPaths, changedPathsTruncated };
};

const editPayload = async ({ service, box, id, ...edit }, session) => {
  logger.info(
    `Edit event payload ${service}/${box}/${id} at revision ${edit.revision}`,
  );

  const result =
    service === GAS
      ? await editGasEvent(box, id, edit, session)
      : await editCaseworkingEvent(box, id, edit);

  logger.info(
    `Finished: Edit event payload ${service}/${box}/${id}, now revision ${result.payloadRevision}`,
  );

  return result;
};

const AUDITED_RESULT_FIELDS = [
  "changedPaths",
  "changedPathsTruncated",
  "beforeHash",
  "afterHash",
];

const auditedResult = (result) =>
  Object.fromEntries(
    AUDITED_RESULT_FIELDS.filter((field) => result?.[field] !== undefined).map(
      (field) => [field, result[field]],
    ),
  );

// Where an edit landed and how, never what it said: the payloads and the note
// hold applicant data and stay on the row. A refused edit is audited too, as a
// FAILURE with no paths and the reason it was refused.
const editPayloadAuditBuilder = (
  [{ service, box, id, caller, actor, revision }],
  result,
  error,
) =>
  buildAuditEvent({
    entity: auditEntities.EVENT,
    action: auditActions.EDIT_EVENT_PAYLOAD,
    entityid: id,
    details: {
      service,
      box,
      caller,
      actor: actor ?? null,
      revision,
      ...auditedResult(result),
      ...(error && { reason: editFailureReason(error) }),
    },
    segregationRef: `event-${id}`,
  });

const editPayloadWithAudit = withAudit(editPayload, editPayloadAuditBuilder);

// GAS: the row and its audit event commit together. Caseworking cannot join a
// Mongo transaction, and audits the change it makes itself.
export const editPayloadUseCase = async (params) =>
  params.service === GAS
    ? withTransaction((session) => editPayloadWithAudit(params, session))
    : editPayloadWithAudit(params);
