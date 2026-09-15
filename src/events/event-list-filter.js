import { ObjectId } from "mongodb";
import { isObjectIdHex } from "../common/object-id-hex.js";
import { auditClauses } from "./event-audit.js";

// `q` is a deliberate unindexed scan: the hot write path must not pay for
// search indexes.

const REGEX_META = /[.*+?^${}()|[\]\\]/g;

const CASE_REF_FIELD = "event.data.caseRef";
const CLIENT_REF_FIELD = "event.data.clientRef";

const DEFAULT_TRACEPARENT_FIELD = "traceparent";

// Exact: breakdown groups on the stored string; a prefix would merge failures.
const LAST_ERROR_MESSAGE_FIELD = "lastError.message";

export const escapeRegex = (value) =>
  value.replace(REGEX_META, String.raw`\$&`);

const trimmed = (value) => (typeof value === "string" ? value.trim() : "");

// Only when `q` is a plausible ObjectId - `new ObjectId("nope")` throws.
const idClauses = (value) =>
  isObjectIdHex(value) ? [{ _id: ObjectId.createFromHexString(value) }] : [];

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

// Bounds match the stored type: a string never matches a Date, nor a non-canonical ISO.
const boundValue = (value, rangeIsDate) => {
  const instant = new Date(value);

  if (rangeIsDate) {
    return instant;
  }

  return Number.isNaN(instant.getTime()) ? value : instant.toISOString();
};

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

// Shared by list, counts and breakdown so chip numbers describe the rows.
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
