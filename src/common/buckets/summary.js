import { summaryLineOf, toIso } from "./bucket.js";
import {
  MAX_VALUES,
  SUMMARY_COUNT_CAP,
  and,
  collectionOf,
  matchParts,
  parseRange,
  parseShow,
  rangePart,
  readCount,
  readOptions,
  readTimeoutMs,
  refuseTimedOut,
} from "./engine.js";
import { EXACT, factsOf, fillOf } from "./plan.js";
import { refuse } from "./refusal.js";

export const parseSummary = (bucket, summaryId, body) => {
  const summary = bucket.summaries.find(({ id }) => id === summaryId);

  if (!summary) {
    throw refuse("UNKNOWN_SUMMARY");
  }

  return { summary, show: parseShow(bucket, body.show), ...parseRange(body) };
};

// Read on the summary's own line: what `among` picks out of the rows the
// list would show, hidden values left out until they are asked for.
const summaryRead = (bucket, { summary, show, from, to }) => {
  const line = summaryLineOf(summary, bucket.lead);

  return {
    bucket,
    query: {
      where: summary.among,
      asked: Object.keys(summary.among),
      show,
      ref: null,
      from,
      to,
    },
    plan: {
      kind: EXACT,
      line,
      filled: factsOf(bucket, line).filter((fact) => !line.includes(fact)),
      residual: [],
    },
    deadline: Date.now() + readTimeoutMs(),
  };
};

const fillsOf = (read) =>
  read.plan.filled.reduce(
    (fills, fact) =>
      fills.flatMap((fill) =>
        [...fillOf(read.bucket, fact, read.query.show), null].map((value) => ({
          ...fill,
          [fact]: value,
        })),
      ),
    [{}],
  );

// One scan steps from one distinct value of a fact to the next under what is
// already fixed, within the time range: the keys examined are the values found, not the rows. A
// MongoDB `$group` steps the index only on a single field, so a combination
// of facts is found one fact at a time.
const stepValues = (read, fact) => async (match) => {
  const groups = await collectionOf(read)
    .aggregate(
      [
        { $match: match },
        { $group: { _id: `$${fact}` } },
        { $limit: MAX_VALUES + 1 },
      ],
      readOptions(read),
    )
    .toArray()
    .catch(refuseTimedOut);

  return groups.map(({ _id }) => _id ?? null);
};

const widen = (read, fill, fact) => async (combination) => {
  const found = await stepValues(
    read,
    fact,
  )({
    ...fill,
    ...read.query.where,
    ...combination,
    ...rangePart(read),
  });

  return found.map((value) => ({ ...combination, [fact]: value }));
};

const widenAll = (read, fill) => async (pending, fact) => {
  const widened = await Promise.all(
    (await pending).map(widen(read, fill, fact)),
  );

  return widened.flat();
};

// A fact the fill already fixes, such as the lead, is taken from it; each
// other fact is stepped under the combinations found before it.
const readValuesWithin = (read, by) => async (fill) => {
  const fixed = Object.fromEntries(
    by
      .filter((fact) => Object.hasOwn(fill, fact))
      .map((fact) => [fact, fill[fact]]),
  );
  const combinations = await by
    .filter((fact) => !Object.hasOwn(fill, fact))
    .reduce(widenAll(read, fill), Promise.resolve([fixed]));

  return combinations.map((values) =>
    Object.fromEntries(by.map((fact) => [fact, values[fact]])),
  );
};

const textOf = (values) => JSON.stringify(Object.values(values));

const byText = (a, b) => textOf(a).localeCompare(textOf(b));

const readSummaryValues = async (read, by) => {
  const found = await Promise.all(
    fillsOf(read).map(readValuesWithin(read, by)),
  );
  const distinct = new Map(
    found.flat().map((values) => [textOf(values), values]),
  );

  return [...distinct.values()].sort(byText);
};

const readTime = (read, direction) => async () => {
  const field = read.bucket.time.field;
  const [row] = await collectionOf(read)
    .find(and(matchParts(read)), {
      ...readOptions(read),
      sort: { [field]: direction, _id: direction },
      projection: { [field]: 1, _id: 0 },
      limit: 1,
    })
    .toArray()
    .catch(refuseTimedOut);

  return toIso(row?.[field]);
};

const readEntry = (read) => async (values) => {
  const narrowed = {
    ...read,
    query: {
      ...read.query,
      asked: [...read.query.asked, ...Object.keys(values)],
      where: { ...read.query.where, ...values },
    },
  };
  const [counted, firstAt, lastAt] = await Promise.all([
    readCount(narrowed, SUMMARY_COUNT_CAP),
    readTime(narrowed, 1)(),
    readTime(narrowed, -1)(),
  ]);

  return { values, ...counted, firstAt, lastAt };
};

const mostFirst = (a, b) => b.count - a.count || byText(a.values, b.values);

export const runSummary = async (bucket, query) => {
  const { id, by, top } = query.summary;
  const read = summaryRead(bucket, query);
  const values = await readSummaryValues(read, by);
  const counted = await Promise.all(
    values.slice(0, MAX_VALUES).map(readEntry(read)),
  );
  const entries = counted.filter(({ count }) => count > 0).sort(mostFirst);

  return {
    bucket: bucket.id,
    summary: id,
    entries: entries.slice(0, top),
    more: entries.length > top,
    complete: values.length <= MAX_VALUES,
  };
};
