// Why the last attempt at an inbox/outbox event failed, recorded on the
// document so the events admin list can show it without anyone reading the
// logs. Deliberately three flat fields: never the stack (it can carry payload
// fragments) and never the error object itself (it is not BSON-safe).
const MAX_MESSAGE_LENGTH = 1024;

// Attempt-history messages are truncated harder than `lastError`: ten entries
// live on every document, so 512 keeps a worst-case history well inside a sane
// document size while still leaving a readable message.
const MAX_ATTEMPT_MESSAGE_LENGTH = 512;

// Only the ten most recent attempts are kept. Long enough to see a retry
// pattern, short enough that a row that has failed thousands of times is still
// a small document.
export const MAX_ATTEMPT_HISTORY = 10;

const DEFAULT_NAME = "Error";

export const CLAIM_EXPIRED_NAME = "ClaimExpired";
export const CLAIM_EXPIRED_MESSAGE = "claim expired before completion";

const nameOf = (error) => error.name ?? DEFAULT_NAME;

// A thrown string has no `message`, so the value itself is the message.
// Truncated because a driver or SDK error can carry a very long body.
const messageOf = (error, maxLength) =>
  String(error.message ?? error).slice(0, maxLength);

export const toLastError = (error) => {
  if (!error) {
    return null;
  }

  return {
    name: nameOf(error),
    message: messageOf(error, MAX_MESSAGE_LENGTH),
    at: new Date().toISOString(),
  };
};

// The claim-expiry sweep has no exception to record: nothing threw, the worker
// simply stopped answering, so the sweep names itself.
export const claimExpiredError = () => ({
  name: CLAIM_EXPIRED_NAME,
  message: CLAIM_EXPIRED_MESSAGE,
  at: new Date().toISOString(),
});

// One entry of `attemptHistory` - the same three fields as `lastError` in the
// order the detail view renders them, built with the same truncation so a
// history entry can never carry more than the `lastError` it came from.
export const toAttemptEntry = (error) => {
  if (!error) {
    return null;
  }

  return {
    at: new Date().toISOString(),
    name: nameOf(error),
    message: messageOf(error, MAX_ATTEMPT_MESSAGE_LENGTH),
  };
};

// The claim-expiry sweep's own history entry, matching `claimExpiredError`.
export const claimExpiredAttempt = () => ({
  at: new Date().toISOString(),
  name: CLAIM_EXPIRED_NAME,
  message: CLAIM_EXPIRED_MESSAGE,
});

const asArray = (history) => (Array.isArray(history) ? history : []);

// A stored `attemptHistory` of the wrong type - or absent, as on every row
// written before this change - reads back as an empty array rather than
// throwing, and an over-long one is trimmed on the way in as well as on the
// way out, so a document hand-edited past the cap cannot grow further.
export const normaliseAttemptHistory = (history) =>
  asArray(history).slice(-MAX_ATTEMPT_HISTORY);

// In-memory append, used by the models: oldest first, capped at the ten most
// recent. No entry (a resubmission sweep calling `markAsFailed()` with no
// exception) appends nothing, exactly as it leaves `lastError` alone.
export const appendAttempt = (history, entry) => {
  if (!entry) {
    return normaliseAttemptHistory(history);
  }

  return normaliseAttemptHistory([...asArray(history), entry]);
};

// The same append as a Mongo update fragment, for the repository sweeps that
// touch many rows with one `updateMany` and never load a model. `$slice: -10`
// applies the cap server-side, so the sweep never has to read a row first.
export const pushAttemptUpdate = (entry) => ({
  attemptHistory: { $each: [entry], $slice: -MAX_ATTEMPT_HISTORY },
});
