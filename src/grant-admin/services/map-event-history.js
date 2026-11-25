import { HISTORY_KINDS } from "../../events/event-history.js";
import { REDRIVABLE_STATUSES } from "../../events/event-redrive.js";
import { withJsonNumbers } from "../../events/plain-json.js";
import { actorName } from "./event-display.js";
import { toAttemptHistory, toIso } from "./map-event-row.js";

const RECEIVED = "received";
const ATTEMPT = "attempt";
const DELIVERED = "delivered";

// Newest first within one millisecond too: a delivery or a death ends what
// the attempt before it started, and a receipt starts everything.
const TIE_ORDER = [
  DELIVERED,
  HISTORY_KINDS.DEAD_LETTERED,
  ATTEMPT,
  HISTORY_KINDS.PURGED,
  HISTORY_KINDS.REDRIVEN,
  HISTORY_KINDS.PAYLOAD_EDITED,
  RECEIVED,
];

const toText = (value, fallback) =>
  value === null || value === undefined ? fallback : String(value);

// Rebuilt key by key, like the attempts: another version's entry must not
// fail response validation, and a kind this version has not heard of is left
// out.
const STORED_ENTRIES = {
  [HISTORY_KINDS.DEAD_LETTERED]: (entry) => ({ at: toIso(entry.at) }),
  [HISTORY_KINDS.REDRIVEN]: (entry) => ({
    at: toIso(entry.at),
    by: actorName(entry.by),
  }),
  [HISTORY_KINDS.PURGED]: (entry) => ({
    at: toIso(entry.at),
    by: actorName(entry.by),
    reasonCode: toText(entry.reasonCode, ""),
    note: toText(entry.note, null),
  }),
  [HISTORY_KINDS.PAYLOAD_EDITED]: (entry) => ({
    at: toIso(entry.at),
    by: actorName(entry.by),
    note: toText(entry.note, null),
    before: entry.before ?? null,
  }),
};

const toStoredEntry = (entry) => {
  const build = STORED_ENTRIES[entry?.kind];

  return build ? { kind: entry.kind, ...build(entry) } : null;
};

const storedHistoryOf = (doc) =>
  (Array.isArray(doc.history) ? doc.history : [])
    .map(toStoredEntry)
    .filter(Boolean);

const hasStored = (stored, kind, at) =>
  stored.some((entry) => entry.kind === kind && entry.at === at);

// A row written before the history existed, or by a pod that predates it,
// keeps only its last redrive, purge and edit; each becomes an entry unless
// the stored history already has it.
const derived = (stored, kind, record, build) => {
  const at = toIso(record?.at);

  return at && !hasStored(stored, kind, at)
    ? [{ kind, at, by: actorName(record.by), ...build(record) }]
    : [];
};

const purgeFacts = (record) => ({
  reasonCode: toText(record.reasonCode, ""),
  note: toText(record.note, null),
});

// The original payload is the before of the first edit, so it is the last
// edit's image only at revision 1: one edit and nothing else since.
const editFacts = (doc) => (record) => ({
  note: toText(record.note, null),
  before: doc.payloadRevision === 1 ? (doc.originalPayload ?? null) : null,
});

// A row that died before the history existed, or on a pod that predates it
// since its last redrive, has no record of when; its last failure is the
// nearest instant there is.
const hasDeathFor = (stored, redrive, at) => {
  const redrivenAt = Date.parse(toIso(redrive?.at));

  return (
    hasStored(stored, HISTORY_KINDS.DEAD_LETTERED, at) ||
    stored.some(
      (entry) =>
        entry.kind === HISTORY_KINDS.DEAD_LETTERED &&
        !(Date.parse(entry.at) <= redrivenAt),
    )
  );
};

const derivedDeath = (stored, doc) => {
  const at = toIso(doc.lastResubmissionDate);
  const isDead = REDRIVABLE_STATUSES.includes(doc.status);
  const hasDeath = hasDeathFor(stored, doc.lastRedrive, at);

  return isDead && at && !hasDeath
    ? [{ kind: HISTORY_KINDS.DEAD_LETTERED, at }]
    : [];
};

const derivedEntries = (stored, doc) => [
  ...derived(stored, HISTORY_KINDS.REDRIVEN, doc.lastRedrive, () => ({})),
  ...derived(stored, HISTORY_KINDS.PURGED, doc.lastPurge, purgeFacts),
  ...derived(
    stored,
    HISTORY_KINDS.PAYLOAD_EDITED,
    doc.lastEdit,
    editFacts(doc),
  ),
  ...derivedDeath(stored, doc),
];

const instantOf = (entry) => {
  const at = Date.parse(entry.at);

  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
};

const oldestFirst = (a, b) => instantOf(a) - instantOf(b) || a.seq - b.seq;

const diffOf = (before, after) =>
  before === null || after === undefined || after === null
    ? { before: null, after: null }
    : { before: withJsonNumbers(before), after: withJsonNumbers(after) };

// Each edit's after is what the next edit started from, or the payload now.
const withDiffs = (entries, payload) => {
  const edits = entries
    .filter((entry) => entry.kind === HISTORY_KINDS.PAYLOAD_EDITED)
    .sort(oldestFirst);

  edits.forEach((edit, index) => {
    const next = edits[index + 1];

    Object.assign(edit, diffOf(edit.before, next ? next.before : payload));
  });

  return entries;
};

const attemptEntries = (doc) =>
  toAttemptHistory(doc.attemptHistory).map((attempt, index) => ({
    kind: ATTEMPT,
    at: attempt.at,
    number: index + 1,
    name: attempt.name,
    message: attempt.message,
    stack: attempt.stack,
  }));

const instantEntry = (kind, value) => {
  const at = toIso(value);

  return at ? [{ kind, at }] : [];
};

const newestFirst = (a, b) =>
  instantOf(b) - instantOf(a) ||
  TIE_ORDER.indexOf(a.kind) - TIE_ORDER.indexOf(b.kind) ||
  b.seq - a.seq;

const withoutSeq = ({ seq, ...entry }) => entry;

export const toEventHistory = (doc) => {
  const stored = storedHistoryOf(doc);
  const entries = [
    ...instantEntry(RECEIVED, doc.publicationDate),
    ...attemptEntries(doc),
    ...stored,
    ...derivedEntries(stored, doc),
    ...instantEntry(DELIVERED, doc.completionDate),
  ].map((entry, seq) => ({ ...entry, seq }));

  return withDiffs(entries, doc.event ?? null)
    .sort(newestFirst)
    .map(withoutSeq);
};
