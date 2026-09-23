import Boom from "@hapi/boom";
import { constants } from "node:http2";
import { REDRIVABLE_STATUSES } from "./event-redrive.js";
import { jsonKindOf } from "./plain-json.js";

// Long enough for a sentence, short enough that nobody pastes a payload in.
export const EDIT_NOTE_MAX = 500;

// Measured pretty-printed, as the admin shows it. The row keeps two copies of
// the payload once edited, and the admin renders one element per line.
export const PAYLOAD_MAX_BYTES = 256 * 1024;

export const EDIT_REFUSAL_REASONS = {
  TOO_LARGE: "TOO_LARGE",
  UNCHANGED: "UNCHANGED",
  NOT_AN_OBJECT: "NOT_AN_OBJECT",
  DOLLAR_KEY: "DOLLAR_KEY",
};

// Why a save was refused, as a FAILURE audit event records it.
const EDIT_FAILURE_REASONS = {
  ...EDIT_REFUSAL_REASONS,
  NOT_FOUND: "NOT_FOUND",
  NOT_EDITABLE: "NOT_EDITABLE",
  STALE: "STALE",
};

export const EDITABLE_DESCRIPTION = `editable (${REDRIVABLE_STATUSES.join(" or ")})`;

// A row never edited has no counter; it reads as revision 0.
export const payloadRevisionOf = (doc) => doc?.payloadRevision ?? 0;

// Revision 0 is a row never edited: the field is missing, null or 0.
export const revisionFilter = (revision) =>
  revision === 0 ? { $in: [null, 0] } : revision;

const editRecord = ({ at, by, note }) => ({
  at: (at ?? new Date()).toISOString(),
  by: by ?? null,
  note,
});

// Given by the first edit alone, so later edits never push the original out.
// Not keyed on revision 0: a purge or a redrive moves the revision on too.
const originalFor = (original) =>
  original === undefined ? {} : { originalPayload: original };

export const editUpdate = ({
  event,
  by,
  note,
  revision,
  original,
  inboxColumns,
  at,
}) => ({
  $set: {
    event,
    payloadRevision: revision + 1,
    lastEdit: editRecord({ at, by, note }),
    ...originalFor(original),
    ...inboxColumns,
  },
});

export const staleEdit = (box, id) =>
  Boom.preconditionFailed(
    `${box} event "${id}" was edited since the revision given`,
  );

// The same body shape as `redriveConflict`, in an edit's own words.
export const editConflict = (box, id, status, statusLabel) => {
  const error = Boom.conflict(
    `${box} event "${id}" is ${status}, not ${EDITABLE_DESCRIPTION}`,
  );

  error.output.payload.status = status;
  error.output.payload.statusLabel = statusLabel;

  return error;
};

export const editRefusal = (reason) => {
  const error = Boom.badData(`Payload refused: ${reason}`);

  error.output.payload.reason = reason;

  return error;
};

const FAILURE_REASONS_BY_STATUS = {
  [constants.HTTP_STATUS_NOT_FOUND]: () => EDIT_FAILURE_REASONS.NOT_FOUND,
  [constants.HTTP_STATUS_CONFLICT]: () => EDIT_FAILURE_REASONS.NOT_EDITABLE,
  [constants.HTTP_STATUS_PRECONDITION_FAILED]: () => EDIT_FAILURE_REASONS.STALE,
  [constants.HTTP_STATUS_UNPROCESSABLE_ENTITY]: (payload) =>
    payload?.reason ?? null,
};

// Null for a failure that is not a refusal, such as an unreachable Caseworking.
export const editFailureReason = (error) => {
  const reasonOf = FAILURE_REASONS_BY_STATUS[error?.output?.statusCode];

  return reasonOf ? reasonOf(error.output.payload) : null;
};

const isObject = (value) => jsonKindOf(value) === "object";

// Mongo refuses to store a `$` key at any depth.
const hasDollarKey = (value) => {
  if (Array.isArray(value)) {
    return value.some(hasDollarKey);
  }

  return (
    isObject(value) &&
    Object.entries(value).some(
      ([key, child]) => key.startsWith("$") || hasDollarKey(child),
    )
  );
};

const prettyBytes = (payload) =>
  Buffer.byteLength(JSON.stringify(payload, null, 2));

// Unchanged is decided by the caller, which has the changed paths.
export const assertStorable = (payload) => {
  if (!isObject(payload)) {
    throw editRefusal(EDIT_REFUSAL_REASONS.NOT_AN_OBJECT);
  }

  if (prettyBytes(payload) > PAYLOAD_MAX_BYTES) {
    throw editRefusal(EDIT_REFUSAL_REASONS.TOO_LARGE);
  }

  if (hasDollarKey(payload)) {
    throw editRefusal(EDIT_REFUSAL_REASONS.DOLLAR_KEY);
  }
};
