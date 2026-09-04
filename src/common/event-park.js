import Boom from "@hapi/boom";

// Park: taking one poison DEAD_LETTER row OUT of the retry loop by hand, and
// unpark: putting it back. Mirrored in fg-cw-backend so both services behave
// the same way, exactly as `event-redrive.js` is.
//
// PARKED is terminal and operator-set. The whole point is that no poller sweep
// can ever touch it again:
//
//   - the claim filters select `status === PUBLISHED`, so a parked row is
//     never claimed;
//   - `updateFailedEvents` selects FAILED and `updateResubmittedEvents`
//     selects RESUBMITTED, so neither can resurrect it;
//   - the dead-letter sweep's `status: { $ne: DEAD_LETTER }` WOULD have
//     matched a parked row and dragged it back to DEAD_LETTER, so both boxes
//     in both services now exclude PARKED explicitly (`$nin`);
//   - the claim-expiry sweep's `$nin: [DEAD_LETTER, COMPLETED]` had the same
//     hole and excludes PARKED too.
//
// Those four filters are asserted against a real parked document in
// event-park.test.js, captured from the repositories rather than restated, so
// changing any of them fails a test instead of quietly un-parking poison.

export const PARK_FROM_STATUS = "DEAD_LETTER";
export const UNPARK_FROM_STATUS = "PARKED";
export const PARKED_STATUS = "PARKED";

// `by` is the operator the mutation was made on behalf of - the `x-actor`
// header GAS validated and forwarded. Null when nobody named themselves.
export const parkUpdate = ({ reason, by = null, at = new Date() }) => ({
  $set: {
    status: PARKED_STATUS,
    parked: { at: at.toISOString(), reason, by: by ?? null },
    claimedBy: null,
    claimedAt: null,
    claimExpiresAt: null,
  },
});

// Deliberately minimal: unparking restores the row to the status it was parked
// from and clears the parking record. `lastError`, `attemptHistory` and
// `completionAttempts` are untouched - they are the record of why it died, and
// an unparked row is a dead letter again, not a fresh one. An operator who
// wants it retried redrives it afterwards.
export const unparkUpdate = () => ({
  $set: {
    status: PARK_FROM_STATUS,
    parked: null,
  },
});

// 409, with the status that actually blocked the transition in the body so the
// caller can render "this row is COMPLETED now" without a second request.
export const parkConflict = (label, id, status, expected) => {
  const error = Boom.conflict(
    `${label} event "${id}" is ${status}, not ${expected}`,
  );

  error.output.payload.status = status;

  return error;
};
