import Boom from "@hapi/boom";
import { NO_ERROR_KEY } from "../common/buckets/error-key.js";

// Without the reset the dead-letter sweep would re-kill the row before a claim.
const RESET_ATTEMPTS = 0;

export const DEAD_LETTER = "DEAD_LETTER";

// Purged sequenced outbox events are terminal because purge releases successors.
export const REDRIVABLE_STATUSES = [DEAD_LETTER, "PURGED"];

export const REDRIVABLE_DESCRIPTION = `redrivable (${REDRIVABLE_STATUSES.join(" or ")})`;

const redriveRecord = (by, at) => ({
  at: (at ?? new Date()).toISOString(),
  by: by ?? null,
});

// History resets with the count; `lastError` stays as the only record of the
// cause, and so does the key of a recorded error. The key of a death with none
// goes with the death.
export const redriveUpdate = (resubmittedStatus, { by, at } = {}) => [
  {
    $set: {
      status: resubmittedStatus,
      retryable: true,
      completionAttempts: RESET_ATTEMPTS,
      attemptHistory: [],
      lastRedrive: { $literal: redriveRecord(by, at) },
      expireAt: null,
      claimedBy: null,
      claimedAt: null,
      claimExpiresAt: null,
      errorKey: {
        $cond: [{ $eq: ["$errorKey", NO_ERROR_KEY] }, null, "$errorKey"],
      },
      // An editor opened before the redrive must not save onto what came of it.
      payloadRevision: { $add: [{ $ifNull: ["$payloadRevision", 0] }, 1] },
    },
  },
];

// The status labels are passed in: this module is shared with the pollers.
export const redriveConflict = (box, id, status, statusLabel, message) => {
  const error = Boom.conflict(
    message ??
      `${box} event "${id}" is ${status}, not ${REDRIVABLE_DESCRIPTION}`,
  );

  error.output.payload.status = status;
  error.output.payload.statusLabel = statusLabel;

  return error;
};
