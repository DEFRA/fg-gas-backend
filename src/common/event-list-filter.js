import { ObjectId } from "mongodb";

// Filter builder shared by the inbox and outbox list endpoints (the events
// admin surface).
//
// TRADEOFF - the `q` clauses are an unindexed collection scan. Only
// `segregationRef` is indexed for the claim path, and the anchored
// case-insensitive regex below cannot use even that index; `traceparent`,
// `event.data.caseRef` and `event.data.clientRef` are not indexed at all, and
// the last two reach inside the stored payload. This is accepted deliberately:
// the events list is an ops/support tool, read at human pace by one operator
// at a time and served off a secondary read, so it must never pay for extra
// indexes on the hot claim/publish write path. If the boxes ever grow past a
// scan-able size, add a collation-backed index on `segregationRef` and plain
// indexes on `messageId` / `event.id` / `traceparent` rather than narrowing
// the search - an operator holding a trace id or a case reference and getting
// no rows back is the failure mode this exists to prevent.
//
// `from`/`to` are the exception: they constrain the box's own sort key, which
// IS indexed (the list index is `<sortKey>, _id`), so a time-boxed search
// walks a range of that index instead of the whole collection.

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

// Everything Mongo's regex engine treats as syntax, so a ref containing "."
// or "+" matches literally instead of as a pattern.
const REGEX_META = /[.*+?^${}()|[\]\\]/g;

// Business references live inside the stored payload under `event.data` in
// both boxes, and are matched exactly: an operator pastes a whole caseRef or
// clientRef, never a prefix of one.
const CASE_REF_FIELD = "event.data.caseRef";
const CLIENT_REF_FIELD = "event.data.clientRef";

const DEFAULT_TRACEPARENT_FIELD = "traceparent";

// The failure-breakdown filter. Matched EXACTLY against the stored
// `lastError.message`, never as a prefix or a regex: the value an operator
// filters by is one they clicked out of the breakdown groups, which are
// themselves grouped on that exact stored string. A substring search here
// would silently merge two distinct failures that share a prefix.
const LAST_ERROR_MESSAGE_FIELD = "lastError.message";

export const escapeRegex = (value) => value.replace(REGEX_META, "\\$&");

const trimmed = (value) => (typeof value === "string" ? value.trim() : "");

// Only when `q` is a plausible ObjectId - `new ObjectId("nope")` throws.
const idClauses = (value) =>
  OBJECT_ID_HEX.test(value)
    ? [{ _id: ObjectId.createFromHexString(value) }]
    : [];

// Exact on the box's own event id, on `_id`, on the box's traceparent field
// and on the two payload references; exact or case-insensitive prefix on
// `segregationRef`.
const searchAlternatives = (value, eventIdField, traceparentField) => [
  { [eventIdField]: value },
  ...idClauses(value),
  { segregationRef: value },
  { segregationRef: { $regex: `^${escapeRegex(value)}`, $options: "i" } },
  { [traceparentField]: value },
  { [CASE_REF_FIELD]: value },
  { [CLIENT_REF_FIELD]: value },
];

const searchClauses = (q, eventIdField, traceparentField) => {
  const value = trimmed(q);

  return value
    ? [{ $or: searchAlternatives(value, eventIdField, traceparentField) }]
    : [];
};

// The two boxes store their sort key in different types - the inbox keeps
// `eventTime` as a Z-normalised ISO string (string comparison is chronological
// for those), the outbox keeps `publicationDate` as a BSON Date - so the
// caller says which, and a bound is coerced to match. Comparing a string
// bound against a Date field would silently match nothing.
const boundValue = (value, rangeIsDate) =>
  rangeIsDate ? new Date(value) : value;

// Inclusive at both ends: an operator who types the same minute into both
// boxes expects the events in that minute.
const bounds = (from, to, rangeIsDate) => ({
  ...(from ? { $gte: boundValue(from, rangeIsDate) } : {}),
  ...(to ? { $lte: boundValue(to, rangeIsDate) } : {}),
});

// AND-ed with everything else, as every other filter is: `error=... &
// status=DEAD_LETTER` means both, not either.
const errorClauses = (error) =>
  error ? [{ [LAST_ERROR_MESSAGE_FIELD]: error }] : [];

const rangeClauses = ({ from, to, rangeField, rangeIsDate }) => {
  if (!rangeField || !(from || to)) {
    return [];
  }

  return [{ [rangeField]: bounds(from, to, rangeIsDate) }];
};

const combine = (clauses) =>
  clauses.length === 1 ? clauses[0] : { $and: clauses };

// `status` alone still produces `{ status }` rather than a wrapped `$and`, so
// the pre-search query plan is unchanged.
export const buildEventListFilter = ({
  status,
  q,
  error,
  from,
  to,
  eventIdField,
  traceparentField = DEFAULT_TRACEPARENT_FIELD,
  rangeField,
  rangeIsDate,
}) => {
  const clauses = [
    ...(status ? [{ status }] : []),
    ...searchClauses(q, eventIdField, traceparentField),
    ...errorClauses(error),
    ...rangeClauses({ from, to, rangeField, rangeIsDate }),
  ];

  return clauses.length === 0 ? {} : combine(clauses);
};
