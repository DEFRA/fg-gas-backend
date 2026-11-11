import {
  COUNT_CAP,
  and,
  collectionOf,
  matchParts,
  readOptions,
  readTimeoutMs,
  refuseTimedOut,
} from "./engine.js";
import { EXACT, choosePlan } from "./plan.js";

const DATE = "date";

// An isoString bucket stores its time as text, so it is read as a date first.
const timeOf = ({ time }) =>
  time.type === DATE ? `$${time.field}` : { $toDate: `$${time.field}` };

// A row at `to` itself is counted in the last bin.
const binOf = (bucket, from, binMs, last) => ({
  $min: [
    last,
    { $floor: { $divide: [{ $subtract: [timeOf(bucket), from] }, binMs] } },
  ],
});

const edgesOf = (from, to, binMs) =>
  Array.from({ length: Math.ceil((to - from) / binMs) }, (_, i) => ({
    from: new Date(from.getTime() + i * binMs),
    to: new Date(Math.min(from.getTime() + (i + 1) * binMs, to.getTime())),
  }));

const binRead = (bucket, { where, from, to }) => {
  const asked = Object.keys(where);
  const plan = choosePlan(bucket, asked, false);

  if (plan.kind !== EXACT) {
    throw new Error(`Bucket "${bucket.id}" has no index line for its bins`);
  }

  return {
    bucket,
    query: { where, asked, ref: null, from, to },
    plan,
    deadline: Date.now() + readTimeoutMs(),
  };
};

// The rows the list would show for `where`, counted in bins of `binMs` from
// `from` to `to`, oldest first, in one aggregation on the plan's index line.
// Every match is read; each bin's count is shown up to COUNT_CAP.
export const countBins = async (bucket, { where, from, to, binMs }) => {
  const read = binRead(bucket, { where, from, to });
  const edges = edgesOf(new Date(from), new Date(to), binMs);
  const groups = await collectionOf(read)
    .aggregate(
      [
        { $match: and(matchParts(read)) },
        {
          $group: {
            _id: binOf(bucket, new Date(from), binMs, edges.length - 1),
            count: { $sum: 1 },
          },
        },
      ],
      readOptions(read),
    )
    .toArray()
    .catch(refuseTimedOut);
  const found = new Map(groups.map(({ _id, count }) => [_id, count]));

  return edges.map((edge, i) => {
    const count = found.get(i) ?? 0;

    return {
      from: edge.from.toISOString(),
      to: edge.to.toISOString(),
      count: Math.min(count, COUNT_CAP),
      capped: count > COUNT_CAP,
    };
  });
};
