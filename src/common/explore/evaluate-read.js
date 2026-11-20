import { Decimal128, ObjectId } from "mongodb";

// A day, then nothing or a time: hours, minutes, seconds if given, and the
// zone's offset if not Z.
const DAY_THEN = /^(\d{4})-(\d{2})-(\d{2})(.*)$/;
const TIME_TEXT =
  /^T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const POSITION = /^\d+$/;

export const isText = (value) => typeof value === "string";

const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const TIME_LIMITS = [MAX_HOUR, MAX_MINUTE, MAX_MINUTE, MAX_HOUR, MAX_MINUTE];

// Set, not built with Date.UTC, which reads years 0 to 99 as 1900 to 1999.
const isRealDay = ([, year, month, day]) => {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);

  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === Number(day)
  );
};

const isRealTime = (time) => {
  const parts = TIME_TEXT.exec(time);

  return (
    parts !== null &&
    TIME_LIMITS.every(
      (most, n) => parts[n + 1] === undefined || Number(parts[n + 1]) <= most,
    )
  );
};

const isRealTimeOrNone = (time) => time === "" || isRealTime(time);

// A date written as ISO that names a real day and time: 2026-02-30 is
// refused, not read as 2 March.
export const isDateText = (value) => {
  const parts = isText(value) ? DAY_THEN.exec(value) : null;

  return parts !== null && isRealDay(parts) && isRealTimeOrNone(parts[4]);
};

const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// A real day, `2026-10-01`, and an instant as stored, `toISOString()`'s.
export const isDayText = (value) => DAY_TEXT.test(value) && isDateText(value);

export const isInstantText = (value) =>
  INSTANT_TEXT.test(value) && isDateText(value);

export const isDate = (value) => value instanceof Date;

export const validDate = (date) => (Number.isNaN(date.getTime()) ? null : date);

// A stored Date, or stored text that is an ISO date or time.
export const dateOf = (value) => {
  if (isDate(value)) {
    return validDate(value);
  }

  return isDateText(value) ? new Date(value) : null;
};

const isTagged = (value, tag) =>
  value !== null && typeof value === "object" && Object.hasOwn(value, tag);

// An ObjectId as it travels, { oid }.
export const isOidTag = (value) => isTagged(value, "oid");

// A date typed as ISODate travels as { date }, an ObjectId as { oid }: each
// is read as its text.
export const plainValue = (value) => {
  if (isTagged(value, "date")) {
    return value.date;
  }

  return isOidTag(value) ? value.oid : value;
};

export const typedOf = (value) => {
  if (isTagged(value, "date")) {
    return new Date(value.date);
  }

  return isOidTag(value) ? ObjectId.createFromHexString(value.oid) : value;
};

// ── Reading ──

const isObjectId = (value) => value?._bsontype === "ObjectId";

// A BSON value the driver hands over as an object of its own, such as a
// Decimal128: one value, not an object to look inside. An ObjectId is a type
// of its own.
export const isBsonValue = (value) =>
  typeof value?._bsontype === "string" && !isObjectId(value);

// Where a value sent typed was cut short: never a stored value.
export const CUT = Object.freeze({});

export const isPlainObject = (value) =>
  typeof value === "object" &&
  typeOf(value) === "object" &&
  !Array.isArray(value);

// An object whose fields are read, as opposed to a BSON value.
export const isOpenObject = (value) =>
  isPlainObject(value) && !isBsonValue(value) && value !== CUT;

const NUMERIC_BSON = new Set(["Decimal128", "Long", "Int32", "Double"]);

const DECIMAL = /^([-+]?)(\d*)(?:\.(\d*))?(?:e([-+]?\d+))?$/i;

const withoutTrailingZeros = (digits) => {
  let end = digits.length;

  while (end > 0 && digits[end - 1] === "0") {
    end -= 1;
  }

  return digits.slice(0, end);
};

// A decimal's text as sign, significant digits and exponent, so "1.50" and
// "1.5" read alike; null for text that is no finite decimal.
const canonicalDecimal = ([, sign, whole, fraction, exponent]) => {
  const tail = fraction ?? "";
  const digits = `${whole}${tail}`.replace(/^0+/, "");
  const significant = withoutTrailingZeros(digits);
  const scale =
    Number(exponent ?? 0) - tail.length + (digits.length - significant.length);
  return significant ? `${sign.replace("+", "")}${significant}e${scale}` : "0";
};

export const decimalOf = (text) => {
  const match = DECIMAL.exec(text);

  return match ? canonicalDecimal(match) : null;
};

const isNumericBson = (value) =>
  isBsonValue(value) && NUMERIC_BSON.has(value._bsontype);

// A numeric BSON value a double can't hold exactly (past about 15 digits, or
// 2^53), as its exact decimal; null for any other value.
export const exactOf = (value) => {
  if (!isNumericBson(value)) {
    return null;
  }

  const exact = decimalOf(String(value));
  const number = Number(String(value));
  const held = Number.isFinite(number) ? doubleDecimalOf(number) : null;

  return exact === held ? null : exact;
};

// A BSON value as the plain value Mongo orders and groups it as: a number
// for the numeric types (exactOf says where the number is near), else its
// text.
export const plainBson = (value) => {
  if (!isBsonValue(value)) {
    return value;
  }

  return isNumericBson(value) ? Number(String(value)) : String(value);
};

const decimalParts = (decimal) => {
  const negative = decimal.startsWith("-");
  const [digits, scale] = decimal.replace(/^-/, "").split("e");

  return {
    sign: negative ? -1 : 1,
    digits,
    size: digits.length + Number(scale),
  };
};

const compareDigits = (a, b) => {
  const width = Math.max(a.length, b.length);
  const [x, y] = [a.padEnd(width, "0"), b.padEnd(width, "0")];

  return Math.sign(x.localeCompare(y, "en"));
};

const compareNonZero = (a, b) => {
  const [x, y] = [decimalParts(a), decimalParts(b)];
  const magnitude =
    Math.sign(x.size - y.size) || compareDigits(x.digits, y.digits);

  return x.sign === y.sign ? magnitude * x.sign : Math.sign(x.sign - y.sign);
};

const signOf = (decimal) => {
  if (decimal === "0") {
    return 0;
  }

  return decimal.startsWith("-") ? -1 : 1;
};

// Two decimals from decimalOf in order, exactly.
export const compareDecimals = (a, b) =>
  signOf(a) === 0 || signOf(b) === 0
    ? Math.sign(signOf(a) - signOf(b))
    : compareNonZero(a, b);

const BINARY_PLACES = 1100;

// A finite double's exact value as a decimal from decimalOf: its binary
// fraction written out, not its shortest text.
export const doubleDecimalOf = (number) => {
  let whole = number;
  let places = 0;

  while (!Number.isInteger(whole) && places < BINARY_PLACES) {
    whole *= 2;
    places += 1;
  }

  const digits = BigInt(whole) * 5n ** BigInt(places);

  return decimalOf(`${digits}e-${places}`);
};

// The longest text of a Decimal128: 34 digits, a sign, a point and an
// exponent.
const MAX_DECIMAL_TEXT = 48;

const roundTrips = (text) => {
  try {
    return String(Decimal128.fromString(text)) === text;
  } catch {
    return false;
  }
};

// The text of an exact number, as the x tag carries it: as Decimal128 writes
// it, so it reads back the same.
export const isDecimalTag = (text) =>
  typeof text === "string" &&
  text.length <= MAX_DECIMAL_TEXT &&
  roundTrips(text);

// The end of a filter's walk: the value, and an array's elements one level
// deep, as Mongo's matcher tests them, unless the array is itself a list's
// element taken by position.
const found = (into, value, whole) => {
  into.present = true;

  if (Array.isArray(value) && !whole) {
    value.forEach((element) => into.values.push(element));
  } else {
    into.values.push(value);
  }
};

const walkKey = (value, [name, ...rest], into) => {
  if (Object.hasOwn(value, name)) {
    walkFilter(value[name], rest, into);
  } else {
    into.missing = true;
  }
};

// At a list a key is looked up in each element that is an object, and a
// segment of digits is also that position.
const walkList = (list, names, into) => {
  if (POSITION.test(names[0]) && Number(names[0]) < list.length) {
    walkFilter(list[Number(names[0])], names.slice(1), into, true);
  }

  list
    .filter(isPlainObject)
    .forEach((element) => walkKey(element, names, into));
};

// Mongo's walk of a path in a filter. An object without the next key, or a
// value that isn't one before the path ends, is missing, which null matches.
const walkInto = (value, names, into) => {
  if (Array.isArray(value)) {
    walkList(value, names, into);
  } else if (isPlainObject(value)) {
    walkKey(value, names, into);
  } else {
    into.missing = true;
  }
};

const walkFilter = (value, names, into, whole = false) => {
  if (value === undefined) {
    into.missing = true;
  } else if (names.length === 0) {
    found(into, value, whole);
  } else {
    walkInto(value, names, into);
  }
};

// What a filter finds at a path in one record: whether it is there, whether
// some branch of it is missing, and every value it tests.
export const readAt = (doc, reader, ctx = {}) => {
  if (reader.read) {
    return { present: true, missing: false, values: reader.read(doc, ctx) };
  }

  const into = { present: false, missing: false, values: [] };

  walkKey(doc, reader.names, into);

  return into;
};

export const valuesOf = (doc, reader, ctx = {}) =>
  readAt(doc, reader, ctx).values;

// Mongo's field path in an expression: at a list, the rest of the path from
// each element that is an object, missing ones left out, so a path through
// two lists is a list of lists. Digits are a key here, never a position.
const fieldOfList = (list, names, charge) => {
  charge?.(list.length);

  return list
    .filter(isPlainObject)
    .map((element) => fieldPath(element, names, charge))
    .filter((element) => element !== undefined);
};

const fieldOfObject = (value, [name, ...rest], charge) =>
  isPlainObject(value) && Object.hasOwn(value, name)
    ? fieldPath(value[name], rest, charge)
    : undefined;

const fieldPath = (value, names, charge) => {
  if (names.length === 0) {
    return value;
  }

  return Array.isArray(value)
    ? fieldOfList(value, names, charge)
    : fieldOfObject(value, names, charge);
};

// A path's value in an expression, or undefined when it is missing.
export const valueAt = (doc, reader, ctx = {}) =>
  reader.read
    ? reader.read(doc, ctx)[0]
    : fieldPath(doc, reader.names, reader.charge);

// ── Types, as Mongo orders them ──

export const TYPE_ORDER = {
  null: 1,
  number: 2,
  string: 3,
  object: 4,
  objectId: 7,
  boolean: 8,
  date: 9,
};

const TYPES = [
  ["null", (value) => value === null],
  ["date", isDate],
  ["objectId", isObjectId],
  ["number", (value) => typeof value === "number"],
  ["string", isText],
  ["boolean", (value) => typeof value === "boolean"],
];

export const typeOf = (value) => {
  const [type = "object"] = TYPES.find(([, holds]) => holds(value)) ?? [];

  return type;
};

// A stored value read as the type of the value it is compared with: stored
// ISO text compares with a date as that date.
const asTypeOf = (stored, wanted) =>
  isDate(wanted) && isText(stored) ? dateOf(stored) : stored;

export const order = (a, b) => {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
};

// ObjectIds in order of their 12 bytes, as their lower-case hex is.
const SAME_TYPE_ORDER = {
  date: (a, b) => order(a.getTime(), b.getTime()),
  objectId: (a, b) => order(a.toHexString(), b.toHexString()),
};

export const sameTypeOrder = (a, b) =>
  (SAME_TYPE_ORDER[typeOf(a)] ?? order)(a, b);

// How a stored value compares with a typed one of its type, or null when
// their types differ and no comparison holds.
const COMPARABLE = new Set(["number", "string", "boolean", "date", "objectId"]);

export const compared = (stored, wanted) => {
  const value = asTypeOf(stored, wanted);
  const type = typeOf(wanted);

  return COMPARABLE.has(type) && typeOf(value) === type
    ? sameTypeOrder(value, wanted)
    : null;
};

// A time stored as ISO text and one stored as a Date are one type, so a
// source that keeps both orders and groups them as times.
export const asTime = (value) => (isDateText(value) ? new Date(value) : value);
