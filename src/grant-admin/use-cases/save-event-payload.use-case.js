import Boom from "@hapi/boom";
import { withTransaction } from "../../common/with-transaction.js";
import { logger } from "../../common/logger.js";
import { describeError, statusOf } from "../repositories/cw-http.js";
import { GAS } from "../services/event-sources.js";
import { editPayloadUseCase } from "./edit-payload.use-case.js";
import { getEventUseCase } from "./get-event.use-case.js";
import { redriveEventUseCase } from "./redrive-event.use-case.js";

const CONFLICT = 409;
const PRECONDITION_FAILED = 412;

export const STALE_REVISION = "STALE_REVISION";

const REDRIVEN = { outcome: "redriven" };
const FAILED = { outcome: "failed" };

const conflictOf = (error) => ({
  outcome: "conflict",
  status: error.output.payload.status ?? null,
  statusLabel: error.output.payload.statusLabel ?? null,
});

const redriveArgs = ({ service, box, id, caller, actor }) => ({
  service,
  box,
  id,
  caller,
  actor,
});

// A refused redrive leaves the save standing. In GAS's transaction any other
// failure aborts both; Caseworking's save has already landed, so it says the
// redrive failed.
const redriveAfter = async (params, session) => {
  try {
    await redriveEventUseCase(redriveArgs(params), session);

    return REDRIVEN;
  } catch (error) {
    if (statusOf(error) === CONFLICT) {
      return conflictOf(error);
    }

    if (params.service === GAS) {
      throw error;
    }

    logger.warn(
      `Save event payload ${params.service}/${params.box}: saved, redrive failed (${describeError(error)})`,
    );

    return FAILED;
  }
};

const saveThen = async (params, session) => {
  const saved = await editPayloadUseCase(params, session);

  return {
    ...saved,
    redrive: params.redrive ? await redriveAfter(params, session) : null,
  };
};

const save = (params) =>
  params.service === GAS && params.redrive
    ? withTransaction((session) => saveThen(params, session))
    : saveThen(params);

// The event as it is now, read and audited as the event page reads it, so
// the editor can be drawn again over it. Null when it cannot be read.
const currentEvent = ({ service, box, id, caller }) =>
  getEventUseCase({ service, box, id, caller }).catch((error) => {
    logger.warn(
      `Save event payload ${service}/${box}: stale event unread (${describeError(error)})`,
    );

    return null;
  });

const staleRevision = (event) => {
  const error = Boom.preconditionFailed(
    "The payload was edited since the revision given",
  );

  error.output.payload = {
    ...error.output.payload,
    code: STALE_REVISION,
    event,
  };

  return error;
};

export const saveEventPayloadUseCase = async (params) => {
  try {
    return await save(params);
  } catch (error) {
    if (statusOf(error) !== PRECONDITION_FAILED) {
      throw error;
    }

    throw staleRevision(await currentEvent(params));
  }
};
