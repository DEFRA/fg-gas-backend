import { BREAKDOWN_GROUP_LIMIT } from "../../events/event-breakdown.js";
import { shortEventType } from "./map-event-row.js";

// Merging the per-box failure breakdowns into one answer.
//
// Each box groups on its OWN stored field and hands back the RAW value;
// shortening for display happens here, once: the same failure on the same
// event type must be ONE group whichever box or service it came from, and two
// services cannot be relied on to agree on a display rule.
//
// A group with a null type goes through `shortEventType` - the same function
// the list rows go through - so a group and the rows it counts always read
// the same string, "audit" and "unknown" included; special-casing null here
// would break that. A source that cannot answer the audit question
// (Caseworking) sends no flag, and no flag is "unknown".

// `error` is null for rows dead-lettered before any error was recorded, and
// null is a MEANINGFUL group - real stuck work an operator must see - so the
// key has to tell null apart from the string "null". JSON does that for free
// and no message can collide with it.
const keyOf = (error, type) => JSON.stringify([error, type]);

const earliest = (a, b) => (a === null || (b !== null && b < a) ? b : a);

const latest = (a, b) => (a === null || (b !== null && b > a) ? b : a);

const merge = (into, group) => ({
  error: into.error,
  type: into.type,
  count: into.count + group.count,
  firstAt: earliest(into.firstAt, group.firstAt),
  lastAt: latest(into.lastAt, group.lastAt),
});

// Commonest first. Ties broken on type then error so two runs over the same
// data always produce the same order - an operator watching a list reorder
// itself between refreshes has no idea whether anything changed.
const byCount = (a, b) =>
  b.count - a.count ||
  String(a.type).localeCompare(String(b.type)) ||
  String(a.error).localeCompare(String(b.error));

// `audit` is a grouping fact, not part of the answer: it is resolved into the
// label here and never reaches the wire, where the response schema would
// refuse it.
const displayed = ({ audit, ...group }) => ({
  ...group,
  type: shortEventType(group.type, Boolean(audit)),
});

export const mergeBreakdownGroups = (groupsPerSource) => {
  const merged = new Map();

  for (const group of groupsPerSource.flat().map(displayed)) {
    const key = keyOf(group.error, group.type);
    const existing = merged.get(key);

    merged.set(key, existing ? merge(existing, group) : group);
  }

  return [...merged.values()].sort(byCount).slice(0, BREAKDOWN_GROUP_LIMIT);
};
