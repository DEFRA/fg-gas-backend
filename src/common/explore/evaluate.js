import { Decimal128, ObjectId } from "mongodb";
import { createHash } from "node:crypto";
import { objectCellOf } from "./inline.js";
import { compilePattern } from "./pattern.js";
import {
  TYPE_ORDER,
  asTime,
  compared,
  dateOf,
  isDate,
  CUT,
  isBsonValue,
  isOpenObject,
  isPlainObject,
  plainBson,
  compareDecimals,
  doubleDecimalOf,
  exactOf,
  isText,
  order,
  readAt,
  sameTypeOrder,
  typeOf,
  typedOf,
  validDate,
  valueAt,
  valuesOf,
} from "./evaluate-read.js";

export {
  dateOf,
  isDateText,
  isDayText,
  isInstantText,
  plainValue,
  readAt,
  valueAt,
  valuesOf,
} from "./evaluate-read.js";

// ── Matching ──

const KEYS = {
  date: (value) => `date:${value.getTime()}`,
  objectId: (value) => `objectId:${value.toHexString()}`,
  object: () => null,
};

// An ObjectId is keyed by its hex, apart from the text of it.
const keyOf = (value) => {
  const type = typeOf(value);

  return Object.hasOwn(KEYS, type) ? KEYS[type](value) : `${type}:${value}`;
};

const keysOfStored = (value, dates) => {
  const date = dates && isText(value) ? dateOf(value) : null;

  return [keyOf(value), date && keyOf(date)].filter(Boolean);
};

// Equality to any of the typed values: the same type and value, a date also
// stored as ISO text, and null for a value that is null or missing. An
// ObjectId never equals its hex as text.
const equalsAny = (typed) => {
  const keys = new Set(typed.map(keyOf).filter(Boolean));
  const nulls = typed.includes(null);
  const dates = typed.some(isDate);

  return ({ missing, values }) =>
    (nulls && (missing || values.includes(null))) ||
    values.some((value) =>
      keysOfStored(value, dates).some((key) => keys.has(key)),
    );
};

const COMPARE = {
  lt: (n) => n < 0,
  lte: (n) => n <= 0,
  gt: (n) => n > 0,
  gte: (n) => n >= 0,
};

const comparison =
  (op, [wanted]) =>
  ({ values }) =>
    values.some((value) => {
      const n = compared(value, wanted);

      return n !== null && COMPARE[op](n);
    });

// A pattern tests stored text only, never an ObjectId or any other value,
// and is charged the work it takes.
const patternOf =
  ([{ test }], charge) =>
  ({ values }) =>
    values.some((value) => isText(value) && test(value, charge).matched);

const MATCHERS = {
  eq: (typed) => equalsAny(typed),
  in: (typed) => equalsAny(typed),
  lt: (typed) => comparison("lt", typed),
  lte: (typed) => comparison("lte", typed),
  gt: (typed) => comparison("gt", typed),
  gte: (typed) => comparison("gte", typed),
  regex: patternOf,
  filled:
    () =>
    ({ present }) =>
      present,
};

// $ne, $nin and $exists: false hold when the positive test holds of nothing.
const NEGATED = { ne: "eq", nin: "in", empty: "filled" };

// A pattern is compiled once for its test.
const compiled = ({ pattern, flags }) => ({
  test: compilePattern(pattern, flags),
});

const typedValuesOf = ({ op, values = [] }) =>
  op === "regex" ? values.map(compiled) : values.map(typedOf);

const leafTest = (test, readerOf, charge) => {
  const reader = readerOf(test);
  const positive = Object.hasOwn(NEGATED, test.op) ? NEGATED[test.op] : test.op;
  const holds = MATCHERS[positive](typedValuesOf(test), charge);
  const tested = (doc, ctx) => holds(readAt(doc, reader, ctx));

  return positive === test.op ? tested : (doc, ctx) => !tested(doc, ctx);
};

const NODES = {
  all: (node, compile) => {
    const tests = node.all.map(compile);

    return (doc, ctx) => tests.every((holds) => holds(doc, ctx));
  },
  any: (node, compile) => {
    const tests = node.any.map(compile);

    return (doc, ctx) => tests.some((holds) => holds(doc, ctx));
  },
  not: (node, compile) => {
    const test = compile(node.not);

    return (doc, ctx) => !test(doc, ctx);
  },
};

const nodeKind = (node) =>
  Object.keys(NODES).find((kind) => Object.hasOwn(node, kind));

// The filter as one test of a record. `readerOf` gives a test's reader, by
// its path; `charge` is told the steps each pattern takes.
export const compileWhere = (where, readerOf, charge = () => {}) => {
  const compile = (node) => {
    const kind = nodeKind(node);

    return kind ? NODES[kind](node, compile) : leafTest(node, readerOf, charge);
  };

  return where ? compile(where) : () => true;
};

// ── Shaping ──

const OBJECT_CELL = "{…}";
const LIST_CELL = "[…]";
const MORE_CELL = "…";
// The lists inside lists a cell keeps; one deeper shows as […].
export const MAX_CELL_DEPTH = 8;

// The values one cell shows at most, so a long list can't make a long
// answer: the rest is shown as "…".
const MAX_CELL_VALUES = 100;

const dateText = (date) => validDate(date)?.toISOString() ?? null;

// A BSON value shows as its text, and where a value was cut short as "…".
const closedShape = (value) => {
  if (value === CUT) {
    return MORE_CELL;
  }

  return isBsonValue(value) ? String(value) : OBJECT_CELL;
};

const SHAPES = {
  null: () => null,
  number: (value) => (Number.isFinite(value) ? value : String(value)),
  string: (value) => value,
  boolean: String,
  date: dateText,
  objectId: String,
  object: (value) => closedShape(value),
};

const shapeList = (list, depth, room) => {
  const shown = [];

  for (const element of list) {
    if (room.left <= 0) {
      shown.push(MORE_CELL);

      break;
    }

    shown.push(shapeAt(element, depth + 1, room));
  }

  return shown;
};

const shapeAt = (value, depth, room) => {
  room.left -= 1;

  if (isOpenObject(value)) {
    return objectCellOf(value, room.reader);
  }

  if (!Array.isArray(value)) {
    return SHAPES[typeOf(value)](value);
  }

  return depth <= MAX_CELL_DEPTH ? shapeList(value, depth, room) : LIST_CELL;
};

// A list of exactly one object reads as that object.
const soleObject = (value) =>
  Array.isArray(value) && value.length === 1 && isOpenObject(value[0])
    ? value[0]
    : value;

// A value as a cell shows it: as stored, a date as an ISO instant, a list as
// a list of at most MAX_CELL_VALUES, and an object inline.
export const shapeValue = (value, reader = null) =>
  value === undefined
    ? null
    : shapeAt(value, 1, { left: MAX_CELL_VALUES, reader });

export const cellOf = (doc, reader, ctx = {}) =>
  shapeValue(soleObject(valueAt(doc, reader, ctx)), reader);

// ── Mongo's order ──

const BSON_ORDER = { ...TYPE_ORDER, array: 5 };

const bsonType = (value) => (Array.isArray(value) ? "array" : typeOf(value));

const typeRank = (value) => BSON_ORDER[bsonType(asTime(plainBson(value)))];

// Mongo compares objects field by field: each value's type, then the key,
// then the value; a shorter one first when all before are equal.
const compareEntry = ([keyA, a], [keyB, b]) =>
  order(typeRank(a), typeRank(b)) || order(keyA, keyB) || compareBson(a, b);

const compareEntries = (a, b) => {
  for (let n = 0; n < Math.min(a.length, b.length); n += 1) {
    const by = compareEntry(a[n], b[n]);

    if (by) {
      return by;
    }
  }

  return order(a.length, b.length);
};

const SAME_TYPE = {
  array: (a, b) => compareEntries(a.map(entryOfElement), b.map(entryOfElement)),
  object: (a, b) => compareEntries(Object.entries(a), Object.entries(b)),
};

const entryOfElement = (element) => ["", element];

// A number's exact value, or null for an infinity.
const exactTextOf = (value, plain) => {
  if (exactOf(value)) {
    return exactOf(value);
  }

  return Number.isFinite(plain) ? doubleDecimalOf(plain) : null;
};

// An infinity is further out than a decimal past a double's range.
const infinityRank = (text, plain) => (text === null ? Math.sign(plain) : 0);

const compareExact = (a, b, x, y) => {
  const [p, q] = [exactTextOf(a, x), exactTextOf(b, y)];

  return p !== null && q !== null
    ? compareDecimals(p, q)
    : Math.sign(infinityRank(p, x) - infinityRank(q, y));
};

// NaN is below every other number and equal to NaN, as Mongo orders them.
const compareNaN = (x, y) => Number(Number.isNaN(y)) - Number(Number.isNaN(x));

const hasNaN = (x, y) => Number.isNaN(x) || Number.isNaN(y);

const isNear = (a, b) => Boolean(exactOf(a) || exactOf(b));

// Numbers a double can't tell apart are told apart by their exact decimals.
const compareNumbers = (a, b, x, y) => {
  if (hasNaN(x, y)) {
    return compareNaN(x, y);
  }

  return sameTypeOrder(x, y) || (isNear(a, b) ? compareExact(a, b, x, y) : 0);
};

const compareSameType = (a, b, x, y) => {
  const type = bsonType(x);

  if (type === "number") {
    return compareNumbers(a, b, x, y);
  }

  return Object.hasOwn(SAME_TYPE, type)
    ? SAME_TYPE[type](x, y)
    : sameTypeOrder(x, y);
};

// Any two values in Mongo's full order: by type, then objects key by key and
// lists element by element. A time is one type however stored.
export const compareBson = (a, b) => {
  const [x, y] = [asTime(plainBson(a)), asTime(plainBson(b))];
  const type = bsonType(x);
  const byType = order(BSON_ORDER[type], BSON_ORDER[bsonType(y)]);

  return byType || type === "null" ? byType : compareSameType(a, b, x, y);
};

const scalarKeyOf = (value) => keyOf(asTime(value));

// What makes two values one group: the same type and value, as Mongo's
// $group has it, a time one however it is stored. Objects and lists are
// keyed by a digest of all they hold, keys in their stored order, numbers
// by value, a time however stored; the group's value travels apart from its
// key (orderedOf).
const canonicalOf = (value) => {
  const type = bsonType(value);

  if (type === "array") {
    return ["a", value.map(canonical)];
  }

  if (type === "object") {
    return ["o", Object.entries(value).map(([k, v]) => [k, canonical(v)])];
  }

  return [type, scalarKeyOf(value)];
};

const canonical = (value) =>
  exactOf(value) ? ["decimal", exactOf(value)] : canonicalOf(plainBson(value));

const digestOf = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

const DIGESTED = new Set(["array", "object"]);

const keyOfPlain = (value) => {
  const type = bsonType(value);

  return DIGESTED.has(type) ? `${type}:${digestOf(value)}` : scalarKeyOf(value);
};

const keyOfPresent = (present) =>
  exactOf(present)
    ? `decimal:${exactOf(present)}`
    : keyOfPlain(plainBson(present));

export const groupKeyOf = (value) =>
  value === undefined || value === null ? null : keyOfPresent(value);

// ── Values as they travel ──

// A value kept with its type through JSON, so a sort and a merge across
// boxes and services compare it as Mongo does: text and numbers as they are,
// a list as a list, and a boolean, time, ObjectId or object tagged. At most
// MAX_CELL_VALUES values travel:
// a value cut short ends in a tag that says so, shown as …, and a longer one compares
// by what is kept. It is only ever shown as the value's cell.
const NON_FINITE = { NaN, Infinity, "-Infinity": -Infinity };

const ORDERED = {
  null: () => null,
  number: (value) => (Number.isFinite(value) ? value : { n: String(value) }),
  string: (value) => value,
  boolean: (value) => ({ b: value }),
  date: (value) => (validDate(value) ? { d: value.toISOString() } : null),
  objectId: (value) => ({ o: String(value) }),
};

const orderedEntries = (entries, depth, room) => {
  const kept = [];

  for (const [key, value] of entries) {
    if (room.left <= 0) {
      break;
    }

    kept.push([key, orderedAt(value, depth + 1, room)]);
  }

  return kept;
};

// Lists and objects as deep as a cell keeps lists; deeper is cut.
const orderedPlain = (value, depth, room) => {
  if (Array.isArray(value) || typeOf(value) === "object") {
    return depth > MAX_CELL_DEPTH ? CUT_TAG : orderedNested(value, depth, room);
  }

  return ORDERED[typeOf(value)](value);
};

const orderedAt = (stored, depth, room) => {
  room.left -= 1;

  return exactOf(stored)
    ? { x: String(Decimal128.fromString(String(stored))) }
    : orderedPlain(plainBson(stored), depth, room);
};

const orderedList = (list, depth, room) => {
  const kept = orderedEntries(
    list.map((element) => ["", element]),
    depth,
    room,
  ).map(([, element]) => element);

  return kept.length < list.length ? [...kept, CUT_TAG] : kept;
};

// An object cut short ends in an entry that says so, shown as … in its text.
const CUT_TAG = { c: true };

const orderedObject = (value, depth, room) => {
  const entries = Object.entries(value);
  const kept = orderedEntries(entries, depth, room);

  return {
    k: kept.length < entries.length ? [...kept, [MORE_CELL, CUT_TAG]] : kept,
  };
};

const orderedNested = (value, depth, room) =>
  Array.isArray(value)
    ? orderedList(value, depth, room)
    : orderedObject(value, depth, room);

export const orderedOf = (value) =>
  value === undefined ? null : orderedAt(value, 1, { left: MAX_CELL_VALUES });

const TAGS = {
  c: () => CUT,
  x: (decimal) => Decimal128.fromString(decimal),
  n: (text) => NON_FINITE[text],
  b: (value) => value,
  d: (text) => new Date(text),
  o: (hex) => ObjectId.createFromHexString(hex),
  k: (entries) =>
    Object.fromEntries(
      entries.map(([key, value]) => [key, orderedValue(value)]),
    ),
};

export const orderedValue = (ordered) => {
  if (Array.isArray(ordered)) {
    return ordered.map(orderedValue);
  }

  if (ordered === null || typeof ordered !== "object") {
    return ordered;
  }

  const [tag] = Object.keys(ordered);

  return TAGS[tag](ordered[tag]);
};

export const compareOrdered = (a, b) =>
  compareBson(orderedValue(a), orderedValue(b));

// ── Expressions and accumulators ──

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

// Numbers added as Mongo's $sum adds them (its DoubleDoubleSummation): a sum
// and what it lost, the sum shown, so totals have mongosh's digits. A plain
// sum is kept beside them and shown when the compensated one overflows to
// NaN, as Mongo's is, so [1e308, 1e308, 1] adds to Infinity.
const fast2Sum = (a, b) => {
  const s = a + b;

  return [s, b - (s - a)];
};

const twoSum = (a, b) => {
  const s = a + b;
  const aPrime = s - b;
  const bPrime = s - aPrime;

  return [s, a - aPrime + (b - bPrime)];
};

const added = ([sum, addend, plain], value) => {
  if (!isNumber(value)) {
    return [sum, addend, plain];
  }

  const [x, lower] = fast2Sum(value, addend);
  const [total, lost] = twoSum(sum, x);

  return [total, lower + lost, plain + value];
};

const NO_SUM = [0, 0, 0];

const shownSum = ([sum, , plain]) => (Number.isNaN(sum) ? plain : sum);

const sumOf = (values) => shownSum(values.reduce(added, NO_SUM));

const EXTREMES = { min: (n) => n < 0, max: (n) => n > 0 };

const isCounted = (value) => value !== undefined && value !== null;

// The least or greatest in Mongo's order, nulls and missing left out.
const extremeOf = (fn, values) =>
  values
    .filter(isCounted)
    .reduce(
      (best, value) =>
        best === undefined || EXTREMES[fn](compareBson(value, best))
          ? value
          : best,
      undefined,
    );

const elementsOf = (value) => (Array.isArray(value) ? value : [value]);

// $size, $sum, $min and $max in a projection, on one record's value: a list's
// elements one level deep, else the value itself.
const EXPRESSIONS = {
  count: (value) => (Array.isArray(value) ? value.length : null),
  sum: (value) => sumOf(elementsOf(value)),
  min: (value) => extremeOf("min", elementsOf(value)),
  max: (value) => extremeOf("max", elementsOf(value)),
};

const workedOut = (fn, doc, reader, ctx) =>
  EXPRESSIONS[fn](valueAt(doc, reader, ctx));

// An expression's cell, and the value it sorts by.
export const expressionOf = (fn, doc, reader, ctx = {}) =>
  shapeValue(soleObject(workedOut(fn, doc, reader, ctx)), reader);

export const orderedExpressionOf = (fn, doc, reader, ctx = {}) =>
  orderedOf(workedOut(fn, doc, reader, ctx));

// $sum, $min and $max in $group, over each record's whole value, as raw
// values until the group is sent; count(*) counts records. A sum is sent as
// its sum and what it lost, so the parts add as Mongo's would.
const ACCUMULATE = {
  count: (sofar = 0) => sofar + 1,
  sum: (sofar, value) => added(sofar ?? NO_SUM, value),
  min: (sofar, value) => extremeOf("min", [sofar, value]),
  max: (sofar, value) => extremeOf("max", [sofar, value]),
};

export const accumulate = (fn, sofar, value) => ACCUMULATE[fn](sofar, value);

// A sum's parts that aren't finite are tagged, as JSON has no NaN.
const SENT_PARTIAL = {
  count: (raw = 0) => raw,
  sum: (raw = NO_SUM) => raw.map(ORDERED.number),
  min: (raw) => orderedOf(raw),
  max: (raw) => orderedOf(raw),
};

export const sentPartial = (fn, raw) => SENT_PARTIAL[fn](raw);

const isSent = (partial) => partial !== null;

const extremeOfSent = (fn, a, b) =>
  [a, b]
    .filter(isSent)
    .reduce(
      (best, next) =>
        best === null || EXTREMES[fn](compareOrdered(next, best)) ? next : best,
      null,
    );

// A sum sent as one number, or as a pair with no plain sum, as a service
// before these sends it.
const sentParts = (partial) =>
  Array.isArray(partial) ? partial.map(orderedValue) : [partial ?? 0];

const sumParts = (partial) => {
  const [sum, addend = 0, plain = sum] = sentParts(partial);

  return [sum, addend, plain];
};

// A part that overflowed, to NaN or to an infinity that `added` leaves out,
// leaves the merged sum NaN, so its plain sum shows.
const mergedSum = ([sumA, addendA, plainA], [sumB, addendB, plainB]) => {
  const [total, lost] = added(added([sumA, addendA, 0], sumB), addendB);

  return [Number.isFinite(sumB) ? total : Number.NaN, lost, plainA + plainB];
};

// Two parts of one group's aggregate as one, typed as they were sent.
const PARTIALS = {
  count: (a, b) => a + b,
  sum: (a, b) => SENT_PARTIAL.sum(mergedSum(sumParts(a), sumParts(b))),
  min: (a, b) => extremeOfSent("min", a, b),
  max: (a, b) => extremeOfSent("max", a, b),
};

export const mergePartial = (fn, a, b) => PARTIALS[fn](a, b);

// A merged aggregate as its cell shows it, and as a group sorts by it.
const PARTIAL_VALUES = {
  count: (partial) => partial,
  sum: (partial) => shownSum(sumParts(partial)),
  min: orderedValue,
  max: orderedValue,
};

export const partialValue = (fn, partial) =>
  partial === null || partial === undefined
    ? null
    : PARTIAL_VALUES[fn](partial);

export const shownPartial = (fn, partial) =>
  shapeValue(partialValue(fn, partial));

// A value sent typed, as its cell shows it.
export const shownOrdered = (ordered) => shapeValue(orderedValue(ordered));

// The value a row sorts by, as Mongo's sort takes it: a list's least element
// lowest first, its greatest highest first.
export const orderValueOf = (doc, reader, desc, ctx = {}) =>
  orderedOf(
    extremeOf(desc ? "max" : "min", valuesOf(doc, reader, ctx)) ?? null,
  );

// ── $unwind ──

const isUnwound = (value) =>
  value !== undefined &&
  value !== null &&
  !(Array.isArray(value) && !value.length);

// The value at a path followed through objects only, as $unwind follows it.
const throughObjects = (doc, names) =>
  names.reduce(
    (value, name) =>
      isPlainObject(value) && Object.hasOwn(value, name)
        ? value[name]
        : undefined,
    doc,
  );

const withAt = (value, [name, ...rest], element) => {
  const copy = { ...value };

  if (!rest.length) {
    if (element === undefined) {
      delete copy[name];
    } else {
      copy[name] = element;
    }

    return copy;
  }

  copy[name] = withAt(value[name], rest, element);

  return copy;
};

// One record as the rows $unwind makes of it: one per element of the list
// at the path, the path set to it; none for an empty list, null or a
// missing path, unless kept, when the record stays (an empty list's key
// removed); any other value, the record once.
const preserved = (doc, names, value) =>
  Array.isArray(value) ? withAt(doc, names) : doc;

const eachElement = function* (doc, names, list) {
  for (const element of list) {
    yield withAt(doc, names, element);
  }
};

const unwoundAt = function* (doc, names, preserve) {
  const value = throughObjects(doc, names);

  if (isUnwound(value)) {
    yield* Array.isArray(value) ? eachElement(doc, names, value) : [doc];
  } else {
    yield* preserve ? [preserved(doc, names, value)] : [];
  }
};

// Made one at a time, so each row is charged before the next is made.
export const unwindDoc = function* (doc, { names, preserve }) {
  yield* names ? unwoundAt(doc, names, preserve) : [doc];
};
