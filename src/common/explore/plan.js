import { widthsOf } from "../buckets/engine.js";
import { BOUNDED, EXACT, REFS, choosePlan } from "../buckets/plan.js";
import { toRef } from "../buckets/refs.js";
import { describePaths } from "./describe.js";
import { compileWhere, isDayText, plainValue } from "./evaluate.js";
import {
  TOO_MANY_COMBINATIONS,
  WITHOUT_PARTNER,
  classifyTests,
  topLevelOf,
} from "./index-tests.js";

export const EXACT_READ = "exact";
export const WINDOWED_READ = "windowed";
export const FULL_READ = "full";

const MS = 1;

const entryOf = (source, { path }) =>
  source.paths.find((entry) => entry.path === path);

const isText = (value) => typeof value === "string";

// ── Facts ──

const isClosed = (fact) => Array.isArray(fact.values);

const NEGATED_FACT = { ne: "eq", nin: "in" };

// A fact is stored as text: no other value can equal it.
const storedValuesOf = (fact, { op, values }) => {
  const typed = values.filter(isText);

  if (!isClosed(fact) || !Object.hasOwn(NEGATED_FACT, op)) {
    return typed;
  }

  // A record without the fact holds too, as Mongo's $ne has it.
  return [
    ...fact.values
      .map(({ value }) => value)
      .filter((value) => !typed.includes(value)),
    null,
  ];
};

const factNameOf = (source, test) => entryOf(source, test).index.fact;

const asFact = (plan, name, test) => {
  const values = storedValuesOf(plan.bucket.facts[name], test);

  plan.where[name] = values.length === 1 ? values[0] : values;
  plan.none ||= values.length === 0;
};

// ── Refs ──

const declaresKind = (bucket, kind) =>
  Object.hasOwn(bucket.refs, kind) || bucket.links.includes(kind);

// A ref path's value as the ref its record holds, trimmed and lower case;
// `refs` itself as typed. A kind the bucket doesn't hold, or a value no ref
// can be, finds nothing.
const storedRefOf = (plan, source, path, value) => {
  const { index } = entryOf(source, { path });

  if (!isText(value)) {
    return null;
  }

  if (index.refs) {
    return value;
  }

  return declaresKind(plan.bucket, index.ref) ? toRef(index.ref, value) : null;
};

const refsOf = (plan, source, test) =>
  test.values
    .map((value, n) =>
      storedRefOf(plan, source, test.paths?.[n] ?? test.path, value),
    )
    .filter(Boolean);

const matchOf = (values) => (values.length === 1 ? values[0] : { $in: values });

// The test as Mongo reads it, on the source's own path for it, never the
// text typed: the refs index finds every record that ever held the value, in
// any case, and this keeps only those that hold it now, as typed.
const exactOf = (source, { path, values }) => ({
  [entryOf(source, { path }).path]: matchOf(values.filter(isText)),
});

const isOwnRef = (kind) => (value) =>
  isText(value) && toRef(kind, value) === `${kind}:${value}`;

// `refs` itself, and a path whose record writes its value once as its own
// ref (an SBI, an event's id), typed as that ref is: the index alone reads
// it exactly, so its count stays on the index.
const isExactRef =
  (source) =>
  ({ path, values }) => {
    const { index } = entryOf(source, { path });

    return (
      Boolean(index.refs) ||
      (Boolean(index.stable) && values.every(isOwnRef(index.ref)))
    );
  };

const recheckOf = (source, test) => {
  const branches = test.branches ?? [test];

  if (branches.every(isExactRef(source))) {
    return null;
  }

  return test.branches
    ? { $or: branches.map((branch) => exactOf(source, branch)) }
    : exactOf(source, test);
};

// One ref, or a list of them read as one $in, and the test itself.
const asRef = (plan, test, source) => {
  const refs = [...new Set(refsOf(plan, source, test))];

  plan.ref = refs.length === 1 ? refs[0] : refs;
  plan.refKind = entryOf(source, test).index.ref ?? null;
  plan.recheck = recheckOf(source, test);
  plan.none ||= refs.length === 0;
};

// ── Time ──

const BOUNDS = {
  eq: (at) => ({ from: at, to: at }),
  lt: (at) => ({ to: new Date(at.getTime() - MS) }),
  lte: (at) => ({ to: at }),
  gt: (at) => ({ from: new Date(at.getTime() + MS) }),
  gte: (at) => ({ from: at }),
};

// A day typed as text compares as text, as mongosh's does: every stored time
// of that day is longer, so greater. `$gt` takes the day, `$lte` doesn't.
const DAY_BOUNDS = { ...BOUNDS, lte: BOUNDS.lt, gt: BOUNDS.gte };

const boundsOf = (value) =>
  isText(value) && isDayText(value) ? DAY_BOUNDS : BOUNDS;

const either = (pick) => (a, b) =>
  [a, b]
    .filter(Boolean)
    .reduce((kept, next) => (kept ? pick(kept, next) : next), null);

const later = either((a, b) => (a > b ? a : b));
const earlier = either((a, b) => (a < b ? a : b));

const isTyped = (value) => typeof value === "object";

// A date bound reads every box; a text one only a box that stores its times
// as text, as Mongo compares text only with text.
const asTime = (plan, test) => {
  const [value] = test.values;
  const { from, to } = boundsOf(value)[test.op](new Date(plainValue(value)));

  plan.from = later(plan.from, from);
  plan.to = earlier(plan.to, to);
  plan.none ||= !isTyped(value) && plan.bucket.time.type === "date";
};

// ── The box itself ──

const asBox = (plan, test, readerOf) => {
  plan.none ||= !compileWhere(test, readerOf)({}, plan.box);
};

const TAKE = {
  fact: (plan, test, source) => asFact(plan, factNameOf(source, test), test),
  ref: (plan, test, source) => asRef(plan, test, source),
  refs: (plan, test, source) => asRef(plan, test, source),
  time: (plan, test) => asTime(plan, test),
  box: (plan, test, _source, readerOf) => asBox(plan, test, readerOf),
};

// A fact test the index can't take still narrows the read when Mongo can
// match it: the engine tests it row by row, never the evaluator.
const FILTERED_REASONS = [WITHOUT_PARTNER, TOO_MANY_COMBINATIONS];

const isFiltered = (plan, source, { test, field, why }) =>
  FILTERED_REASONS.includes(why) &&
  field.index === "fact" &&
  ["eq", "in"].includes(test.op) &&
  !Object.hasOwn(plan.where, factNameOf(source, test));

const residualOf = (tests) => {
  if (tests.length === 0) {
    return null;
  }

  return tests.length === 1 ? tests[0] : { all: tests };
};

const iso = (date) => date?.toISOString();

const isEmptyRange = ({ from, to }) => Boolean(from && to && from > to);

const engineQueryOf = (plan, query) => ({
  where: plan.where,
  asked: Object.keys(plan.where),
  ref: plan.ref,
  refKind: plan.refKind,
  from: iso(plan.from),
  to: iso(plan.to),
  cursor: null,
  limit: query.limit,
  groupBy: [],
  count: false,
});

const pathOf = (test) => test.path ?? null;

const whyOf = (tests, enginePlan) => {
  const first = tests.find(({ why }) => why);

  if (first) {
    return { why: first.why, path: pathOf(first.test) };
  }

  return enginePlan.kind === EXACT
    ? null
    : { why: TOO_MANY_COMBINATIONS, path: null };
};

const route = (plan, source, readerOf) => (entry) => {
  if (!entry.why) {
    TAKE[entry.field.index](plan, entry.test, source, readerOf);

    return false;
  }

  if (isFiltered(plan, source, entry)) {
    asFact(plan, factNameOf(source, entry.test), entry.test);

    return false;
  }

  return true;
};

// A ref's facts are promoted to exact only with nothing left for the
// evaluator to test.
const settles = (enginePlan, residual) =>
  enginePlan.line === REFS &&
  enginePlan.kind === BOUNDED &&
  residual.length === 0;

// A query tests what a record holds, as Mongo would: a fact the lists read
// as a value when a record holds none (`nullAs`) holds none here.
const raw = new WeakMap();

const withoutNullAs = (bucket) => ({
  ...bucket,
  facts: Object.fromEntries(
    Object.entries(bucket.facts).map(([name, fact]) => [
      name,
      { ...fact, nullAs: null },
    ]),
  ),
});

export const rawEquality = (bucket) => {
  if (!raw.has(bucket)) {
    raw.set(bucket, withoutNullAs(bucket));
  }

  return raw.get(bucket);
};

// One box's reads: the top-level AND's index tests go to the bucket engine,
// whose plan decides whether the read is exact; every other test is a
// residual the evaluator applies to each record read. `why` says why a read
// isn't exact.
export const planBox = (source, box, query, readerOf) => {
  const bucket = rawEquality(box.bucket);
  const plan = {
    bucket,
    box,
    where: {},
    ref: null,
    refKind: null,
    recheck: null,
    from: null,
    to: null,
    none: false,
  };
  const paths = describePaths(source, box.bucket);
  const { tests } = classifyTests(
    topLevelOf(query.where),
    (path) => paths.get(path) ?? null,
  );
  const residual = tests
    .filter(route(plan, source, readerOf))
    .map(({ test }) => test);
  const engineQuery = engineQueryOf(plan, query);
  const enginePlan = choosePlan(
    bucket,
    engineQuery.asked,
    plan.ref !== null,
    widthsOf(bucket, engineQuery),
  );
  const why = whyOf(tests, enginePlan);

  return {
    none: plan.none || isEmptyRange(plan),
    bucket,
    query: engineQuery,
    plan: enginePlan,
    recheck: plan.recheck,
    residual: residualOf(residual),
    read: why ? WINDOWED_READ : EXACT_READ,
    why,
    settles: settles(enginePlan, residual),
  };
};
