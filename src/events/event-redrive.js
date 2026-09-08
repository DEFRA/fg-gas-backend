import Boom from "@hapi/boom";

// Redrive: putting one DEAD_LETTER inbox/outbox row back in front of the
// poller. Shared by both boxes because the poller invariants are identical,
// and mirrored in fg-cw-backend so both services behave the same way.
//
// The claim filter is `status === PUBLISHED && claimedBy === null &&
// completionAttempts < MAX_RETRIES`, and the dead-letter sweep re-kills
// anything with `completionAttempts >= MAX_RETRIES`. A dead-lettered row has
// `completionAttempts >= MAX_RETRIES` by construction, so a redrive that left
// the counter alone would be re-dead-lettered on the next tick and would never
// be claimed.
//
// Resetting to 0 matches a freshly inserted event (see ATTEMPT ARITHMETIC in
// models/inbox.js): a redriven row arrives at PUBLISHED with zero attempts
// made and gets the same MAX_RETRIES fresh attempts a new one would.
const RESET_ATTEMPTS = 0;

export const REDRIVE_FROM_STATUS = "DEAD_LETTER";

// `lastError`, `attemptHistory` and `lastResubmissionDate` are deliberately
// left in place: they are the record of why the row died, and the existing
// resubmission sweeps (updateFailedEvents / updateResubmittedEvents) do not
// touch them either.
//
// `by` is the operator the redrive was made on behalf of - the `x-actor`
// header GAS validated and forwarded. `lastRedrive` is recorded on the row
// itself as well as in the audit event, so the detail view can say who put
// this row back without a search through the audit log.
const redriveRecord = (by, at) => ({
  at: (at ?? new Date()).toISOString(),
  by: by ?? null,
});

export const redriveUpdate = (resubmittedStatus, { by, at } = {}) => ({
  $set: {
    status: resubmittedStatus,
    completionAttempts: RESET_ATTEMPTS,
    lastRedrive: redriveRecord(by, at),
    claimedBy: null,
    claimedAt: null,
    claimExpiresAt: null,
  },
});

// 409, with the status that actually blocked the redrive in the body so the
// caller can render "this row is COMPLETED now" without a second request - and
// with the words to render it in, passed in rather than looked up here: the
// display vocabulary belongs to the admin surface that draws it, and this
// module is shared with the pollers, which draw nothing.
export const redriveConflict = (box, id, status, statusLabel) => {
  const error = Boom.conflict(
    `${box} event "${id}" is ${status}, not ${REDRIVE_FROM_STATUS}`,
  );

  error.output.payload.status = status;
  error.output.payload.statusLabel = statusLabel;

  return error;
};
