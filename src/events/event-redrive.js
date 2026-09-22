import Boom from "@hapi/boom";

// Without the reset the dead-letter sweep would re-kill the row before a claim.
const RESET_ATTEMPTS = 0;

export const DEAD_LETTER = "DEAD_LETTER";

// Wider than the redrive fence, which still matches DEAD_LETTER alone.
export const REDRIVABLE_STATUSES = [DEAD_LETTER, "PURGED"];

const redriveRecord = (by, at) => ({
  at: (at ?? new Date()).toISOString(),
  by: by ?? null,
});

// History resets with the count; `lastError` stays as the only record of the cause.
export const redriveUpdate = (resubmittedStatus, { by, at } = {}) => ({
  $set: {
    status: resubmittedStatus,
    retryable: true,
    completionAttempts: RESET_ATTEMPTS,
    attemptHistory: [],
    lastRedrive: redriveRecord(by, at),
    expireAt: null,
    claimedBy: null,
    claimedAt: null,
    claimExpiresAt: null,
  },
});

// The status labels are passed in: this module is shared with the pollers.
export const redriveConflict = (box, id, status, statusLabel) => {
  const error = Boom.conflict(
    `${box} event "${id}" is ${status}, not ${DEAD_LETTER}`,
  );

  error.output.payload.status = status;
  error.output.payload.statusLabel = statusLabel;

  return error;
};
