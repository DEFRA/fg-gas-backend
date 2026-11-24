import { BSON, Int32, Long } from "mongodb";
import { createHash } from "node:crypto";
import { ORDERED, orderedOf, orderedValue } from "./evaluate-ordered.js";
import {
  NO_SUM,
  added,
  isInt32,
  mergedSum,
  sumOf,
  typedSum,
} from "./evaluate-sum.js";
import { objectCellOf } from "./inline.js";
import { compilePattern } from "./pattern.js";
import { refuseQuery } from "./refusal.js";
import {
  TYPE_ORDER,
  asTime,
  compared,
  dateOf,
  isDate,
  isBsonValue,
  isNumericBson,
  isOpenObject,
  isPlainObject,
  plainBson,
  promotedOf,
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

export { bsonValueOf, orderedOf, orderedValue } from "./evaluate-ordered.js";

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

// A stored Decimal128 or Long is keyed as the double it equals, if any.
const storedKeyOf = (value) => {
  if (!isNumericBson(value)) {
    return keyOf(value);
  }

  return exactOf(value) ? null : keyOf(plainBson(value));
};

const keysOfStored = (value, dates) => {
  const date = dates && isText(value) ? dateOf(value) : null;

  return [storedKeyOf(value), date && keyOf(date)].filter(Boolean);
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

// A stored Decimal128 or Long is compared with a number exactly; a NaN of
// any type is in no range.
const isNaNStored = (stored) =>
  (typeof stored === "number" || isNumericBson(stored)) &&
  Number.isNaN(plainBson(stored));

const comparedOf = (stored, wanted) => {
  if (isNaNStored(stored)) {
    return null;
  }

  return isNumericBson(stored) && typeof wanted === "number"
    ? compareBson(stored, wanted)
    : compared(stored, wanted);
};

const comparison =
  (op, [wanted]) =>
  ({ values }) =>
    values.some((value) => {
      const n = comparedOf(value, wanted);

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

const promotedAt = (found) => ({
  ...found,
  values: found.values.map(promotedOf),
});

const leafTest = (test, readerOf, charge) => {
  const reader = readerOf(test);
  const positive = Object.hasOwn(NEGATED, test.op) ? NEGATED[test.op] : test.op;
  const holds = MATCHERS[positive](typedValuesOf(test), charge);
  const tested = (doc, ctx) => holds(promotedAt(readAt(doc, reader, ctx)));

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

const dateText = (date) => validDate(date)?.toISOString() ?? null;

// A regex shows as mongosh writes it; any other value as its own text.
const textOfBson = (value) =>
  value?._bsontype === "BSONRegExp"
    ? `/${value.pattern}/${value.options}`
    : String(value);

// A number of a BSON type shows as a number where one holds it exactly, as
// the driver promotes it; a Decimal128 or any other BSON value as its text.
const bsonShape = (value) => {
  const promoted = promotedOf(value);

  return typeof promoted === "number"
    ? SHAPES.number(promoted)
    : textOfBson(promoted);
};

const SHAPES = {
  null: () => null,
  number: (value) => (Number.isFinite(value) ? value : String(value)),
  string: (value) => value,
  boolean: String,
  date: dateText,
  objectId: String,
  object: bsonShape,
};

const shapeAt = (value, reader) => {
  if (value === undefined) {
    return null;
  }

  if (isOpenObject(value)) {
    return objectCellOf(value, reader);
  }

  return Array.isArray(value)
    ? value.map((element) => shapeAt(element, reader))
    : SHAPES[typeOf(value)](value);
};

// A value as a cell shows it, whole: as stored, a date as an ISO instant, a
// list as a list of every element, and an object inline with every key.
export const shapeValue = (value, reader = null) =>
  value === undefined ? null : shapeAt(value, reader);

export const cellOf = (doc, reader, ctx = {}) =>
  shapeValue(valueAt(doc, reader, ctx), reader);

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

const scalarKeyOf = (value) => keyOf(value);

// What makes two values one group: the same type and value, as Mongo's
// $group has it, numbers by value whatever their BSON type, a Date apart
// from ISO text. Objects and lists are keyed by a digest of all they hold,
// keys in their stored order; the group's value travels apart from its key
// (orderedOf).
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

// A value of another BSON type, Binary, Timestamp, Code, a regex, MinKey
// and the rest: its type and its bytes are the value, as mongod keys it. A
// Symbol is its text, as mongod's $group takes it.
const isOtherBson = (value) =>
  value instanceof RegExp ||
  (isBsonValue(value) &&
    !isNumericBson(value) &&
    value._bsontype !== "BSONSymbol");

const bsonHexOf = (value) => BSON.serialize({ v: value }).toString("hex");

const canonicalOfPresent = (value) =>
  isOtherBson(value)
    ? ["bson", bsonHexOf(value)]
    : canonicalOf(plainBson(value));

const canonical = (value) =>
  exactOf(value) ? ["decimal", exactOf(value)] : canonicalOfPresent(value);

const digestOf = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

const DIGESTED = new Set(["array", "object"]);

const keyOfPlain = (value) => {
  const type = bsonType(value);

  return DIGESTED.has(type) ? `${type}:${digestOf(value)}` : scalarKeyOf(value);
};

const keyOfTyped = (present) =>
  isOtherBson(present)
    ? `bson:${bsonHexOf(present)}`
    : keyOfPlain(plainBson(present));

const keyOfPresent = (present) =>
  exactOf(present) ? `decimal:${exactOf(present)}` : keyOfTyped(present);

export const groupKeyOf = (value) =>
  value === undefined || value === null ? null : keyOfPresent(value);

// ── Values as they travel ──

export const compareOrdered = (a, b) =>
  compareBson(orderedValue(a), orderedValue(b));

// ── BSON type names, as mongod's messages give them ──

const BSON_NAMES = {
  Int32: "int",
  Double: "double",
  Long: "long",
  Decimal128: "decimal",
  Binary: "binData",
  Timestamp: "timestamp",
  BSONRegExp: "regex",
  MinKey: "minKey",
  MaxKey: "maxKey",
  Code: "javascript",
  BSONSymbol: "symbol",
  DBRef: "object",
};

const TYPE_NAMES = {
  null: "null",
  date: "date",
  objectId: "objectId",
  number: "double",
  string: "string",
  boolean: "bool",
};

const bsonNameOf = (value) => BSON_NAMES[value._bsontype] ?? "object";

const NAMERS = [
  [(value) => value === undefined, () => "missing"],
  [Array.isArray, () => "array"],
  [(value) => value instanceof RegExp, () => "regex"],
  [isBsonValue, bsonNameOf],
];

const plainNameOf = (value) => TYPE_NAMES[typeOf(value)] ?? "object";

// The type mongod names a value by: "missing" for no value at all.
export const bsonTypeName = (value) => {
  const [, nameOf = plainNameOf] = NAMERS.find(([holds]) => holds(value)) ?? [];

  return nameOf(value);
};

// ── Expressions and accumulators ──

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

export const SIZE_ERROR = "MONGOD_ERROR";

// mongod's own words for $size of anything but a list, and how they are
// read back from its failure: only the type they name.
export const sizeMessage = (type) =>
  `The argument to $size must be an array, but was of type: ${type}`;

export const SIZE_PATTERN =
  /The argument to \$size must be an array, but was of type: ([A-Za-z]+)$/;

// $size of anything but a list fails the query, as mongod's does, naming
// the type it was given.
const sizeOf = (value) => {
  if (!Array.isArray(value)) {
    throw refuseQuery(SIZE_ERROR, {
      fn: "count",
      type: bsonTypeName(value),
      column: null,
    });
  }

  return value.length;
};

// $size, $sum, $min and $max in a projection, on one record's value: a list's
// elements one level deep, else the value itself.
const EXPRESSIONS = {
  count: sizeOf,
  sum: (value) => sumOf(elementsOf(value)),
  min: (value) => extremeOf("min", elementsOf(value)),
  max: (value) => extremeOf("max", elementsOf(value)),
};

const workedOut = (fn, doc, reader, ctx) =>
  EXPRESSIONS[fn](valueAt(doc, reader, ctx));

// An expression's cell, and the value it sorts by.
export const expressionOf = (fn, doc, reader, ctx = {}) =>
  shapeValue(workedOut(fn, doc, reader, ctx), reader);

export const orderedExpressionOf = (fn, doc, reader, ctx = {}) =>
  orderedOf(workedOut(fn, doc, reader, ctx));

// $sum, $min and $max in $group, over each record's whole value, as raw
// values until the group is sent; count(*) counts records. A sum is sent as
// its sum, what it lost, its plain sum, its type and its Decimal128s' sum,
// so the parts add as Mongo's would.
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
  sum: ([sum, addend, plain, type, decimal] = NO_SUM) => [
    ...[sum, addend, plain].map(ORDERED.number),
    type,
    decimal,
  ],
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

// A sum as sent: its three numbers typed, then its type and Decimal128s'
// sum as they are.
const SUM_NUMBERS = 3;

const sumParts = (partial) => [
  ...partial.slice(0, SUM_NUMBERS).map(orderedValue),
  ...partial.slice(SUM_NUMBERS),
];

// Two parts of one group's aggregate as one, typed as they were sent.
const PARTIALS = {
  count: (a, b) => a + b,
  sum: (a, b) => SENT_PARTIAL.sum(mergedSum(sumParts(a), sumParts(b))),
  min: (a, b) => extremeOfSent("min", a, b),
  max: (a, b) => extremeOfSent("max", a, b),
};

export const mergePartial = (fn, a, b) => PARTIALS[fn](a, b);

// A count as mongod's: an Int32, an Int64 past it.
const countValue = (n) =>
  isInt32(n) ? new Int32(n) : Long.fromBigInt(BigInt(n));

// A merged aggregate as its value, typed as mongod's $group gives it: its
// cell shows it, a group sorts by it, and its document holds it.
const PARTIAL_VALUES = {
  count: countValue,
  sum: (partial) => typedSum(sumParts(partial)),
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
// at the path, the path set to it, with the element's index; none for an
// empty list, null or a missing path, unless kept, when the record stays
// (an empty list's key removed) with no index; any other value, the record
// once with no index.
const preserved = (doc, names, value) =>
  Array.isArray(value) ? withAt(doc, names) : doc;

const eachElement = function* (doc, names, list) {
  for (const [index, element] of list.entries()) {
    yield [withAt(doc, names, element), index];
  }
};

const unwoundAt = function* (doc, names, preserve) {
  const value = throughObjects(doc, names);

  if (isUnwound(value)) {
    yield* Array.isArray(value)
      ? eachElement(doc, names, value)
      : [[doc, null]];
  } else {
    yield* preserve ? [[preserved(doc, names, value), null]] : [];
  }
};

// Made one at a time, so each row is charged before the next is made.
export const unwindDoc = function* (doc, { names, preserve }) {
  yield* names ? unwoundAt(doc, names, preserve) : [[doc, null]];
};
