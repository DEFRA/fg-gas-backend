export const EXACT = "exact";
export const BOUNDED = "bounded";
export const REFS = "refs";
export const SCAN_BUDGET = 20_000;
export const MAX_SCANS = 50;

const without = (list, drop) => list.filter((item) => !drop.includes(item));

const isClosed = (bucket, fact) => Array.isArray(bucket.facts[fact].values);

const hasHidden = (bucket, fact) =>
  isClosed(bucket, fact) &&
  bucket.facts[fact].values.some(({ hidden }) => hidden);

// The facts an index key holds: the bucket's lead, then the line's own.
export const factsOf = (bucket, line) => [
  ...bucket.lead,
  ...(line === REFS ? [] : line),
];

// The listed values an unasked fact stands for: all of them once it is shown,
// otherwise those not hidden.
export const fillOf = (bucket, fact, shown) =>
  bucket.facts[fact].values
    .filter(({ hidden }) => shown.includes(fact) || !hidden)
    .map(({ value }) => value);

// Facts that narrow the list although nothing asks for them: an unshown fact
// with hidden values.
const narrowing = (bucket, asked, shown) =>
  without(Object.keys(bucket.facts), [...asked, ...shown]).filter((fact) =>
    hasHidden(bucket, fact),
  );

// One merged scan per combination of filled values; null is always one of them.
export const scansOf = (bucket, line, asked, shown = []) =>
  without(factsOf(bucket, line), asked).reduce(
    (scans, fact) => scans * (fillOf(bucket, fact, shown).length + 1),
    1,
  );

const isUsable = (bucket, asked, shown) => (line) =>
  without(factsOf(bucket, line), asked).every((fact) =>
    isClosed(bucket, fact),
  ) && scansOf(bucket, line, asked, shown) <= MAX_SCANS;

const boundBy = (bucket, line, needed) =>
  factsOf(bucket, line).filter((fact) => needed.includes(fact)).length;

// More needed facts bound wins, then fewer scans, then the order declared.
const better = (bucket, asked, shown, needed) => (chosen, line) => {
  const gain = boundBy(bucket, line, needed) - boundBy(bucket, chosen, needed);
  const cheaper =
    scansOf(bucket, line, asked, shown) < scansOf(bucket, chosen, asked, shown);

  return gain > 0 || (gain === 0 && cheaper) ? line : chosen;
};

const planFor = (bucket, line, asked, needed) => {
  const facts = factsOf(bucket, line);
  const residual = without(needed, facts);

  return {
    kind: residual.length ? BOUNDED : EXACT,
    line,
    filled: without(facts, asked),
    residual,
  };
};

// The time-only line is always usable (`defineBucket` refuses a lead it could
// not fill), so it is where the choice starts.
const bestLine = (bucket, asked, shown, needed) =>
  bucket.indexes
    .filter(isUsable(bucket, asked, shown))
    .reduce(better(bucket, asked, shown, needed), []);

// asked: the fact names in `where`, in request order. hasRef: the request
// carries `ref`. shown: the facts whose hidden values the request asks for.
export const choosePlan = (bucket, asked, hasRef, shown = []) => {
  const needed = [...asked, ...narrowing(bucket, asked, shown)];
  const line = hasRef ? REFS : bestLine(bucket, asked, shown, needed);

  return planFor(bucket, line, asked, needed);
};
