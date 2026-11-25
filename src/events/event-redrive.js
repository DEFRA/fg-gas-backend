import Boom from "@hapi/boom";
import { NO_ERROR_KEY } from "../common/buckets/error-key.js";
import { HISTORY_KINDS, appendAction } from "./event-history.js";

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

// The count resets, so the row gets its retries again; its attempts stay, and
// the redrive's time is what tells those since it apart. `lastError` stays as
// the record of the cause, and so does the key of a recorded error. The key of
// a death with none goes with the death.
export const redriveUpdate = (resubmittedStatus, { by, at } = {}) => {
  const record = redriveRecord(by, at);

  return [
    {
      $set: {
        status: resubmittedStatus,
        retryable: true,
        completionAttempts: RESET_ATTEMPTS,
        lastRedrive: { $literal: record },
        history: appendAction({ kind: HISTORY_KINDS.REDRIVEN, ...record }),
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
};

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
