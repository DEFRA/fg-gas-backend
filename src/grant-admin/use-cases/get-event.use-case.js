import Boom from "@hapi/boom";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import { findById as findGasInboxById } from "../../events/repositories/inbox.repository.js";
import { findById as findGasOutboxById } from "../../events/repositories/outbox.repository.js";
import { applicationExists } from "../../grants/services/application-read.service.js";
import {
  describeError,
  findCwEvent,
} from "../repositories/cw-actuators.repository.js";
import {
  recordRefOf,
  searchRefOf,
} from "../services/resolve-event-record-ref.js";
import { CASEWORKING, GAS } from "../services/event-sources.js";
import { toEventDetail } from "../services/map-event-detail.js";
import { RECORD_KINDS } from "../services/record-kinds.js";

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

const isApplication = async ({ ref, code }) => {
  try {
    return (await applicationExists({ clientRef: ref, code })).exists;
  } catch (error) {
    logger.error(
      `Get event: application link unknown: ${describeError(error)}`,
    );

    return false;
  }
};

// A GAS row links to the application its refs name, once GAS has it. The
// event is still shown when that cannot be checked.
const gasRecordOf = async (detail) => {
  const found = recordRefOf(detail);

  return found && (await isApplication(found))
    ? { kind: RECORD_KINDS.APPLICATION, ...found }
    : null;
};

const getGasEvent = async (box, id) => {
  const doc = await GAS_BOXES[box].find(id);

  if (!doc) {
    throw Boom.notFound(`gas ${box} event "${id}" not found`);
  }

  const detail = toEventDetail({
    service: GAS,
    box,
    doc,
    maxAttempts: GAS_BOXES[box].maxAttempts(),
    retentionDays: config.events.retentionDays,
  });

  return {
    ...detail,
    record: await gasRecordOf(detail),
    searchRef: searchRefOf(detail),
  };
};

// Caseworking checks its own case: a row whose case is missing, or a
// Caseworking that does not say, links to nothing.
const cwRecordOf = (found) =>
  found?.exists === true
    ? {
        kind: RECORD_KINDS.CASE,
        code: found.workflowCode,
        ref: found.caseRef,
      }
    : null;

// No partial mode: half a detail view is not a view.
const getCwEvent = async (box, id) => {
  const doc = await findCwEvent(box, id);

  const detail = toEventDetail({
    service: CASEWORKING,
    box,
    doc,
    maxAttempts: doc.maxAttempts,
  });

  return {
    ...detail,
    record: cwRecordOf(doc.case),
    searchRef: searchRefOf(detail),
  };
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
    security: PMC_0706_SECURITY,
    segregationRef: `event-${id}`,
  });

export const getEventUseCase = withAudit(getEvent, getEventAuditBuilder);
