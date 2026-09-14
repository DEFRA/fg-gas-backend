// Why the last attempt at an inbox/outbox event failed, recorded on the
// document so the events admin list can show it without anyone reading the
// logs. Flat fields only - never the error object itself, which is not
// BSON-safe.
//
// `lastError` stores a capped stack for diagnosis and does NOT serve it: the
// Last error fact draws a name, a message and an instant, so the outbound
// mappers rebuild that fact from those three contract keys and the stack stays
// behind. That rebuild, not a schema, is what keeps it there.
//
// Attempt stacks ARE served, on the detail page's attempts section, where each
// row expands to reveal one. That is a deliberate field on the response
// schema, not a stored object passed through: the outbound mappers build an
// attempt key by key, exactly as they build the `lastError` fact, so a stored
// key nobody declared still cannot reach the wire.
//
// `attemptHistory` entries carry a stack too, capped harder: the detail page
// reveals one per attempt, and ten of them live on every document. At 4KB
// apiece a worst-case history is 40KB of frames - nothing against Mongo's
// 16MB limit, and the cap is what keeps it that way.
const MAX_MESSAGE_LENGTH = 1024;

// Deep enough for the frames that actually locate a failure - an async driver
// stack runs well past the default ten - and bounded so one pathological SDK
// error cannot bloat the document it is recorded on.
const MAX_STACK_LENGTH = 8192;

// Attempt stacks are capped harder than `lastError`'s, for the same reason
// their messages are: ten entries live on every document, so this is the
// figure that decides a worst-case history's size. 4KB apiece leaves the
// frames that locate a failure and puts the ceiling at 40KB.
const MAX_ATTEMPT_STACK_LENGTH = 4096;

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

// A thrown string, or anything else that is not an Error, has no stack to
// record - and an empty one is an absence, not an empty string.
const stackOf = (error, maxLength) =>
  String(error.stack ?? "").slice(0, maxLength) || null;

export const toLastError = (error) => {
  if (!error) {
    return null;
  }

  return {
    name: nameOf(error),
    message: messageOf(error, MAX_MESSAGE_LENGTH),
    at: new Date().toISOString(),
    stack: stackOf(error, MAX_STACK_LENGTH),
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
    stack: stackOf(error, MAX_ATTEMPT_STACK_LENGTH),
  };
};

// The claim-expiry sweep's own history entry, matching `claimExpiredError`.
export const claimExpiredAttempt = () => ({
  at: new Date().toISOString(),
  name: CLAIM_EXPIRED_NAME,
  message: CLAIM_EXPIRED_MESSAGE,
  // Nothing threw - the worker stopped answering - so there is no stack, and
  // the key is present-and-null rather than absent: every entry the detail
  // page renders has the same shape, and only its value decides whether the
  // row can be expanded.
  stack: null,
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
