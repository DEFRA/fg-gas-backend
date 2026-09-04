import Boom from "@hapi/boom";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { config } from "../../common/config.js";
import {
  PARK_FROM_STATUS,
  UNPARK_FROM_STATUS,
  parkConflict,
} from "../../common/event-park.js";
import { logger } from "../../common/logger.js";
import { buildAuditEvent, withAudit } from "../../common/with-audit.js";
import {
  findStatusById as gasInboxStatus,
  parkById as parkGasInbox,
  unparkById as unparkGasInbox,
} from "../../grants/repositories/inbox.repository.js";
import {
  findStatusById as gasOutboxStatus,
  parkById as parkGasOutbox,
  unparkById as unparkGasOutbox,
} from "../../grants/repositories/outbox.repository.js";
import {
  parkCwEvent,
  unparkCwEvent,
} from "../repositories/cw-actuators.repository.js";
import {
  normaliseCwInbox,
  normaliseCwOutbox,
  normaliseGasInbox,
  normaliseGasOutbox,
  toEventRow,
} from "../services/map-event-row.js";

const GAS = "gas";

const GAS_BOXES = {
  inbox: {
    park: parkGasInbox,
    unpark: unparkGasInbox,
    status: gasInboxStatus,
    normalise: (doc) => normaliseGasInbox(doc, config.inbox.inboxMaxRetries),
  },
  outbox: {
    park: parkGasOutbox,
    unpark: unparkGasOutbox,
    status: gasOutboxStatus,
    normalise: (doc) => normaliseGasOutbox(doc, config.outbox.outboxMaxRetries),
  },
};

// Caseworking pre-flattens its list rows, so its own list normalisers apply to
// what its park/unpark endpoints answer with.
const CW_BOXES = { inbox: normaliseCwInbox, outbox: normaliseCwOutbox };

// The update is the precondition - it matches only a row in the status the
// transition is allowed from - so a concurrent change loses cleanly. Nothing
// matched means either the row is gone (404) or it is in some other status
// (409); one extra read tells them apart, and only on the failure path.
const applyToGas = async (box, id, expected, run) => {
  const source = GAS_BOXES[box];
  const doc = await run(source);

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

  throw parkConflict(`gas ${box}`, id, status, expected);
};

// 404 and 409 come back from Caseworking as themselves; anything else is a 502.
const applyToCaseworking = async (box, run) => {
  const row = await run();

  return toEventRow({
    service: "caseworking",
    box,
    intermediate: CW_BOXES[box](row),
  });
};

const park = async ({ service, box, id, reason, actor }) => {
  logger.info(`Park event ${service}/${box}/${id}`);

  const event =
    service === GAS
      ? await applyToGas(box, id, PARK_FROM_STATUS, (source) =>
          source.park(id, { reason, by: actor }),
        )
      : await applyToCaseworking(box, () =>
          parkCwEvent(box, id, { reason, by: actor }),
        );

  logger.info(`Finished: Park event ${service}/${box}/${id}`);

  return { event };
};

const unpark = async ({ service, box, id, actor }) => {
  logger.info(`Unpark event ${service}/${box}/${id}`);

  const event =
    service === GAS
      ? await applyToGas(box, id, UNPARK_FROM_STATUS, (source) =>
          source.unpark(id),
        )
      : await applyToCaseworking(box, () =>
          unparkCwEvent(box, id, { by: actor }),
        );

  logger.info(`Finished: Unpark event ${service}/${box}/${id}`);

  return { event };
};

// Parking takes a row out of the retry loop for good and unparking puts it
// back, so both are audited - who, which row, and why. A 404 or a 409 is
// audited as a FAILURE by `withAudit`: a refused park is still an attempt.
// `actor` is the operator named in the `x-actor` header; `caller` is the
// authenticated service client. Both are recorded, because they answer
// different questions.
export const parkEventAuditBuilder = ([
  { service, box, id, reason, caller, actor },
]) =>
  buildAuditEvent({
    entity: auditEntities.EVENT,
    action: auditActions.PARK_EVENT,
    entityid: id,
    details: { service, box, reason, caller, actor: actor ?? null },
    segregationRef: `event-${id}`,
  });

export const unparkEventAuditBuilder = ([
  { service, box, id, caller, actor },
]) =>
  buildAuditEvent({
    entity: auditEntities.EVENT,
    action: auditActions.UNPARK_EVENT,
    entityid: id,
    details: { service, box, caller, actor: actor ?? null },
    segregationRef: `event-${id}`,
  });

export const parkEventUseCase = withAudit(park, parkEventAuditBuilder);

export const unparkEventUseCase = withAudit(unpark, unparkEventAuditBuilder);
