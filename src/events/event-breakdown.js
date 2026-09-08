// The failure breakdown: how many dead letters share the same failure, and
// which event type they are. One `$match` + `$group` per box, mirrored in
// fg-cw-backend so a group means the same thing whichever service produced it.
//
// SCOPE - always DEAD_LETTER, and only DEAD_LETTER. The breakdown answers "what
// is stuck", so a row that is merely retrying has not failed for good yet and
// is out of scope. `status` is therefore not a parameter: it is pinned by the
// caller's filter.
//
// TRADEOFF - the same accepted collection scan the counts aggregation pays, and
// for the same reason (see status-counts.js). `$sort` on the grouped count
// happens on a set the size of the distinct-failures cardinality, which is
// tiny compared with the box.

// Groups are kept raw on purpose: turning a full type into its short display
// form - the audit label included - is the merge layer's job, so both
// services can group on their own stored field name without agreeing on a
// display rule. Which field that is per box lives in events/event-audit.js,
// beside the predicate that reads it.

// Generous compared with the merged cap so a group that is 21st in one box
// but large overall is not lost before the sum happens.
export const BREAKDOWN_SOURCE_LIMIT = 100;

// Twenty is a screenful; the long tail is reachable by filtering.
export const BREAKDOWN_GROUP_LIMIT = 20;

// `firstAt`/`lastAt` are `$min`/`$max` of the box's own sort key - the same
// field the list orders and time-filters by - so "first seen"/"last seen" mean
// the same thing on the breakdown as everywhere else.
//
// `auditExpression` puts the one fact the type cannot carry into the key: an
// audit record and a type-less anomaly BOTH group under a null type, and they
// are not the same thing, so they must not become one group. The merge layer
// turns the pair into the label the list rows carry.
export const breakdownStages = ({
  filter,
  typeField,
  sortKey,
  auditExpression = { $literal: false },
}) => [
  { $match: filter },
  {
    $group: {
      _id: {
        // Null on a row that died before any error was recorded (a message
        // with no segregationRef is dead-lettered outright), which is itself
        // worth seeing as its own group rather than being dropped.
        error: { $ifNull: ["$lastError.message", null] },
        type: { $ifNull: [`$${typeField}`, null] },
        audit: auditExpression,
      },
      count: { $sum: 1 },
      firstAt: { $min: `$${sortKey}` },
      lastAt: { $max: `$${sortKey}` },
    },
  },
  { $sort: { count: -1 } },
  { $limit: BREAKDOWN_SOURCE_LIMIT },
];

const orNull = (value) => value ?? null;

const toIso = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

// Kept separate so the rebuild below stays inside the configured complexity
// max of 4.
const keyOf = (row) => row._id ?? {};

const countOf = (row) => row.count ?? 0;

// `type` stays the raw stored value and only the merge layer turns the
// (type, audit) pair into a display label. A source that cannot answer the
// audit question - Caseworking has no audit dimension - simply omits it, and
// the merge reads that as false.
export const toBreakdownGroup = (row) => {
  const key = keyOf(row);

  return {
    error: orNull(key.error),
    type: orNull(key.type),
    audit: Boolean(key.audit),
    count: countOf(row),
    firstAt: toIso(row.firstAt),
    lastAt: toIso(row.lastAt),
  };
};

export const toBreakdownGroups = (rows) => (rows ?? []).map(toBreakdownGroup);
