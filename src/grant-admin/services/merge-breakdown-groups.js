import { BREAKDOWN_GROUP_LIMIT } from "../../common/event-breakdown.js";
import { shortEventType } from "./map-event-row.js";

// Merging the per-box failure breakdowns into one answer.
//
// Each box groups on its OWN stored field - `type` for an inbox, `event.type`
// for an outbox - and hands back the RAW value. Shortening for display happens
// here, once, for the same reason the merge happens here: the same failure on
// the same event type must be ONE group whichever box or service it came from,
// and two services cannot be relied on to agree on a display rule. Grouping in
// Mongo on a shortened type would have needed a `$regexFind`/`$replaceOne`
// stage per box and would still have left the two services free to drift.
//
// An outbox audit row stores no `event.type` at all, so it groups under the
// same null `type` the list rows carry for it - a real group, not a dropped
// one, and the frontend renders the absence.

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

const displayed = (group) => ({
  ...group,
  type: group.type ? shortEventType(group.type) : null,
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
