import Boom from "@hapi/boom";

// Without the reset the dead-letter sweep would re-kill the row before a claim.
const RESET_ATTEMPTS = 0;

export const DEAD_LETTER = "DEAD_LETTER";

// A purged row stays redrivable until its deletion date, which is what the
// purge confirm promises.
export const REDRIVABLE_STATUSES = [DEAD_LETTER, "PURGED"];

export const REDRIVABLE_DESCRIPTION = `redrivable (${REDRIVABLE_STATUSES.join(" or ")})`;

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
  // An editor opened before the redrive must not save onto what came of it.
  $inc: { payloadRevision: 1 },
});

// The status labels are passed in: this module is shared with the pollers.
export const redriveConflict = (box, id, status, statusLabel) => {
  const error = Boom.conflict(
    `${box} event "${id}" is ${status}, not ${REDRIVABLE_DESCRIPTION}`,
  );

  error.output.payload.status = status;
  error.output.payload.statusLabel = statusLabel;

  return error;
};
