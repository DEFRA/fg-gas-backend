export const EXACT = "exact";
export const BOUNDED = "bounded";
export const REFS = "refs";
export const SCAN_BUDGET = 20_000;
export const MAX_SCANS = 50;

const without = (list, drop) => list.filter((item) => !drop.includes(item));

const isClosed = (bucket, fact) => Array.isArray(bucket.facts[fact].values);

// The facts an index key holds: the bucket's lead, then the line's own.
export const factsOf = (bucket, line) => [
  ...bucket.lead,
  ...(line === REFS ? [] : line),
];

// The listed values an unasked fact of a line stands for.
export const fillOf = (bucket, fact) =>
  bucket.facts[fact].values.map(({ value }) => value);

// One merged scan per combination of values: each filled fact's listed values
// and null, and each asked fact's values (widths: how many, where more than one).
export const scansOf = (bucket, line, asked, widths = {}) =>
  factsOf(bucket, line).reduce(
    (scans, fact) =>
      scans *
      (asked.includes(fact)
        ? (widths[fact] ?? 1)
        : fillOf(bucket, fact).length + 1),
    1,
  );

const isUsable = (bucket, asked, widths) => (line) =>
  without(factsOf(bucket, line), asked).every((fact) =>
    isClosed(bucket, fact),
  ) && scansOf(bucket, line, asked, widths) <= MAX_SCANS;

const boundBy = (bucket, line, asked) =>
  factsOf(bucket, line).filter((fact) => asked.includes(fact)).length;

// More asked facts bound wins, then fewer scans, then the order declared: the
// line whose facts are just the ones asked is exact in one scan per value.
const better = (bucket, asked, widths) => (chosen, line) => {
  const gain = boundBy(bucket, line, asked) - boundBy(bucket, chosen, asked);
  const cheaper =
    scansOf(bucket, line, asked, widths) <
    scansOf(bucket, chosen, asked, widths);

  return gain > 0 || (gain === 0 && cheaper) ? line : chosen;
};

const planFor = (bucket, line, asked) => {
  const facts = factsOf(bucket, line);
  const residual = without(asked, facts);

  return {
    kind: residual.length ? BOUNDED : EXACT,
    line,
    filled: without(facts, asked),
    residual,
  };
};

// The time-only line is always usable (`defineBucket` refuses a lead it could
// not fill), so it is where the choice starts.
const bestLine = (bucket, asked, widths) =>
  bucket.indexes
    .filter(isUsable(bucket, asked, widths))
    .reduce(better(bucket, asked, widths), []);

// asked: the fact names in `where`, in request order. hasRef: the request
// carries `ref`. widths: how many values an asked fact holds, where more than one.
export const choosePlan = (bucket, asked, hasRef, widths = {}) => {
  const line = hasRef ? REFS : bestLine(bucket, asked, widths);

  return planFor(bucket, line, asked);
};
