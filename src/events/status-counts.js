// The six statuses an inbox/outbox row can hold, and the arithmetic the counts
// endpoints do on them.
//
// TRADEOFF - counting is a `$match` + `$group` aggregation over the same
// filter the list uses. `status` is indexed, but a `$group` still visits every
// document the `$match` selects, so an unfiltered count is a full collection
// scan of the box. That is accepted for the same reason the `q` scan is: this
// is an ops tool, called once per page render by one operator, and the
// alternative (a maintained counters collection) would put write amplification
// on the hot claim/publish path to save a read nobody is waiting on.
export const EVENT_STATUSES = [
  "PUBLISHED",
  "PROCESSING",
  "FAILED",
  "RESUBMITTED",
  "COMPLETED",
  "DEAD_LETTER",
];

// Every key always present: the frontend renders one number per status, and a
// missing key would render as a blank rather than a zero.
export const zeroCounts = () =>
  Object.fromEntries(EVENT_STATUSES.map((status) => [status, 0]));

const isKnownStatus = (counts, row) => Boolean(row) && row._id in counts;

// `$group` only emits the statuses that actually occur, and a rogue document
// can carry a status outside the known set - counted into nothing rather than
// widening the response shape.
export const toStatusCounts = (rows) => {
  const counts = zeroCounts();

  for (const row of rows ?? []) {
    if (isKnownStatus(counts, row)) {
      counts[row._id] += row.count;
    }
  }

  return counts;
};

// Sums several sources into one set of counts. A source that failed contributes
// its zeros, so the totals stay renderable alongside a `sourceErrors` entry.
const countOf = (counts, status) => counts?.[status] ?? 0;

export const sumCounts = (all) => {
  const total = zeroCounts();

  for (const counts of all) {
    for (const status of EVENT_STATUSES) {
      total[status] += countOf(counts, status);
    }
  }

  return total;
};

// The one aggregation stage both boxes in both services group by.
export const statusGroupStage = () => ({
  $group: { _id: "$status", count: { $sum: 1 } },
});
