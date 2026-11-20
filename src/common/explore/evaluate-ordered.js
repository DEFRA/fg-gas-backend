import { BSON, Decimal128, Double, Int32, Long, ObjectId } from "mongodb";
import {
  isBsonValue,
  isOpenObject,
  plainBson,
  typeOf,
  validDate,
} from "./evaluate-read.js";

// A value kept with its type through JSON, whole, so a sort and a merge
// across boxes and services compare it as Mongo does and a group's value is
// sent as stored: text and numbers as they are, a list as a list, and a
// boolean, time, ObjectId, object, number of a BSON type or any other BSON
// value tagged. It is shown only as the value's cell, or as its BSON in a
// group's document.
const NON_FINITE = { NaN, Infinity, "-Infinity": -Infinity };

const doubleTag = (number) => {
  if (Object.is(number, -0)) {
    return "-0";
  }

  return Number.isFinite(number) ? number : String(number);
};

const NUMBER_TAGS = {
  Int32: (value) => ({ i: value.valueOf() }),
  Double: (value) => ({ f: doubleTag(value.valueOf()) }),
  Long: (value) => ({ l: value.toString() }),
  Decimal128: (value) => ({ x: value.toString() }),
};

export const ORDERED = {
  null: () => null,
  number: (value) => (Number.isFinite(value) ? value : { n: String(value) }),
  string: (value) => value,
  boolean: (value) => ({ b: value }),
  date: (value) => (validDate(value) ? { d: value.toISOString() } : null),
  objectId: (value) => ({ o: String(value) }),
};

const isTaggedNumber = (value) =>
  isBsonValue(value) && Object.hasOwn(NUMBER_TAGS, value._bsontype);

// Any other BSON type, Binary, Timestamp, a regex and the rest, travels as
// its own BSON, so a group's document gives it back as stored.
const bsonTagOf = (value) => ({
  e: BSON.serialize({ v: value }).toString("base64"),
});

const bsonOfTag = (base64) =>
  BSON.deserialize(Buffer.from(base64, "base64"), {
    promoteValues: false,
    bsonRegExp: true,
    validation: { utf8: false },
  }).v;

const taggedOf = (stored) =>
  isTaggedNumber(stored)
    ? NUMBER_TAGS[stored._bsontype](stored)
    : bsonTagOf(stored);

const isTagged = (stored) => isBsonValue(stored) || stored instanceof RegExp;

const orderedAt = (stored) => {
  if (isTagged(stored)) {
    return taggedOf(stored);
  }

  if (Array.isArray(stored)) {
    return stored.map(orderedAt);
  }

  if (isOpenObject(stored)) {
    return {
      k: Object.entries(stored).map(([key, value]) => [key, orderedAt(value)]),
    };
  }

  const plain = plainBson(stored);

  return ORDERED[typeOf(plain)](plain);
};

export const orderedOf = (value) =>
  value === undefined ? null : orderedAt(value);

const doubleOfTag = (tag) =>
  new Double(tag === "-0" ? -0 : (NON_FINITE[tag] ?? tag));

const tagsOf = (entriesOf) => ({
  x: (decimal) => Decimal128.fromString(decimal),
  n: (text) => NON_FINITE[text],
  b: (value) => value,
  d: (text) => new Date(text),
  o: (hex) => ObjectId.createFromHexString(hex),
  i: (number) => new Int32(number),
  f: doubleOfTag,
  l: (text) => Long.fromString(text),
  e: bsonOfTag,
  k: entriesOf,
});

const valueWith = (tags) => {
  const decode = (ordered) => {
    if (Array.isArray(ordered)) {
      return ordered.map(decode);
    }

    if (ordered === null || typeof ordered !== "object") {
      return ordered;
    }

    const [tag] = Object.keys(ordered);

    return tags(decode)[tag](ordered[tag]);
  };

  return decode;
};

export const orderedValue = valueWith((decode) =>
  tagsOf((entries) =>
    Object.fromEntries(entries.map(([key, value]) => [key, decode(value)])),
  ),
);

// A value sent typed as BSON writes it: an object as a Map, so its keys keep
// their stored order whatever they are.
export const bsonValueOf = valueWith((decode) =>
  tagsOf(
    (entries) => new Map(entries.map(([key, value]) => [key, decode(value)])),
  ),
);
