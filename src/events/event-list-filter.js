import { ObjectId } from "mongodb";
import { auditClauses } from "./event-audit.js";

// Filter builder shared by the inbox and outbox list endpoints.
//
// TRADEOFF - the `q` clauses are a deliberate unindexed collection scan: the
// events list is an ops tool read at human pace off a secondary, and must
// never pay for extra indexes on the hot claim/publish write path. If the
// boxes outgrow a scan, add indexes (collation-backed `segregationRef`, plain
// `messageId` / `event.id` / `traceparent`) rather than narrowing the search -
// an operator getting no rows back for a real reference is the failure mode
// this exists to prevent. `from`/`to` are the exception: they constrain the
// box's indexed sort key (`<sortKey>, _id`).

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

// Everything Mongo's regex engine treats as syntax, so a ref containing "."
// or "+" matches literally instead of as a pattern.
const REGEX_META = /[.*+?^${}()|[\]\\]/g;

const CASE_REF_FIELD = "event.data.caseRef";
const CLIENT_REF_FIELD = "event.data.clientRef";

const DEFAULT_TRACEPARENT_FIELD = "traceparent";

// Matched EXACTLY, never as a prefix or regex: the value an operator filters
// by was clicked out of the breakdown groups, which group on that exact
// stored string - a substring search would merge distinct failures sharing a
// prefix.
const LAST_ERROR_MESSAGE_FIELD = "lastError.message";

export const escapeRegex = (value) =>
  value.replace(REGEX_META, String.raw`\$&`);

const trimmed = (value) => (typeof value === "string" ? value.trim() : "");

// Only when `q` is a plausible ObjectId - `new ObjectId("nope")` throws.
const idClauses = (value) =>
  OBJECT_ID_HEX.test(value)
    ? [{ _id: ObjectId.createFromHexString(value) }]
    : [];

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
//
// A STRING bound is canonicalised into the same form the field is stored in,
// for the same reason the field itself is: `isoDate()` accepts
// `2026-06-16T11:00:00+01:00` and `2026-06-16`, and comparing either of those
// as text against a `…Z` value compares the wrong characters. Both parse to
// the instant the operator meant; only the spelling has to be made to match.
const boundValue = (value, rangeIsDate) => {
  const instant = new Date(value);

  if (rangeIsDate) {
    return instant;
  }

  return Number.isNaN(instant.getTime()) ? value : instant.toISOString();
};

// Inclusive at both ends: an operator who types the same minute into both
// boxes expects the events in that minute.
const bounds = (from, to, rangeIsDate) => ({
  ...(from ? { $gte: boundValue(from, rangeIsDate) } : {}),
  ...(to ? { $lte: boundValue(to, rangeIsDate) } : {}),
});

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
//
// The list, the faceted counts and the failure breakdown all build their
// filter here, so a clause added here is answered by all three at once - the
// numbers on the filter chips must describe the rows underneath them, and the
// only way to guarantee that is one shared expression.
export const buildEventListFilter = ({
  status,
  q,
  error,
  from,
  to,
  audit,
  eventIdField,
  traceparentField = DEFAULT_TRACEPARENT_FIELD,
  targetField,
  rangeField,
  rangeIsDate,
}) => {
  const clauses = [
    ...(status ? [{ status }] : []),
    ...searchClauses(q, eventIdField, traceparentField),
    ...errorClauses(error),
    ...rangeClauses({ from, to, rangeField, rangeIsDate }),
    ...auditClauses(audit, targetField),
  ];

  return clauses.length === 0 ? {} : combine(clauses);
};
