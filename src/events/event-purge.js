import Boom from "@hapi/boom";
import { DEAD_LETTER } from "./event-redrive.js";
import { expiryFrom } from "./event-retention.js";

// A fixed vocabulary, so the Purged view can group by it; the free-text note
// carries the detail.
export const PURGE_REASON_CODES = ["BROKEN_PAYLOAD", "SENT_IN_ERROR", "OTHER"];

export const PURGE_REASON_REQUIRING_NOTE = "OTHER";

// Long enough for a sentence, short enough that nobody pastes a payload in.
export const PURGE_NOTE_MAX = 500;

// An ISO string, like `lastRedrive.at`, so a service that serialises only
// top-level Dates still returns it as an instant.
const purgeRecord = ({ by, reasonCode, note, at }) => ({
  at: at.toISOString(),
  by: by ?? null,
  reasonCode,
  note: note ?? null,
});

// One `now` serves both the record and the deadline, so the stored pair can
// never disagree about when the purge happened.
export const purgeUpdate = (
  purgedStatus,
  { by, reasonCode, note, retentionDays, at } = {},
) => {
  const when = at ?? new Date();

  return {
    $set: {
      status: purgedStatus,
      lastPurge: purgeRecord({ by, reasonCode, note, at: when }),
      // A BSON Date: the TTL index does not read strings.
      expireAt: expiryFrom(when, retentionDays),
    },
    // An editor opened before the purge must not save onto the purged row.
    $inc: { payloadRevision: 1 },
  };
};

// The status labels are passed in: this module is shared with the pollers.
export const purgeConflict = (box, id, status, statusLabel) => {
  const error = Boom.conflict(
    `${box} event "${id}" is ${status}, not ${DEAD_LETTER}`,
  );

  error.output.payload.status = status;
  error.output.payload.statusLabel = statusLabel;

  return error;
};
