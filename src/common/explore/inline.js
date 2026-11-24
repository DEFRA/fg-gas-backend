import { isBsonValue, isOpenObject, typeOf } from "./evaluate-read.js";

const PLAIN_KEY = /^[A-Za-z_]\w*$/;
const HEX = 16;

const NAMED_ESCAPES = {
  "\\": "\\\\",
  "'": "\\'",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
  "\v": "\\v",
};

const ESCAPED = /[\\'\p{Cc}]/gu;

const C1 = 0x80;

// Quotes, backslashes and the C0 controls and DELETE are escaped; the C1
// controls are written as they are.
const escapeOf = (ch) => {
  if (Object.hasOwn(NAMED_ESCAPES, ch)) {
    return NAMED_ESCAPES[ch];
  }

  const code = ch.charCodeAt(0);

  return code >= C1 ? ch : `\\x${code.toString(HEX).padStart(2, "0")}`;
};

const quoted = (text) => `'${text.replace(ESCAPED, escapeOf)}'`;

const keyText = (key) => (PLAIN_KEY.test(key) ? key : quoted(key));

// Int32 and Double print as plain numbers, as mongosh prints them.
const BSON_TEXT = {
  Binary: (value) =>
    `Binary.createFromBase64('${value.toString("base64")}', ${value.sub_type})`,
  Timestamp: (value) => `Timestamp({ t: ${value.t}, i: ${value.i} })`,
  BSONRegExp: (value) => `/${value.pattern}/${value.options}`,
  Int32: (value) => String(value.valueOf()),
  Double: (value) =>
    Object.is(value.valueOf(), -0) ? "-0" : String(value.valueOf()),
};

const bsonText = (value) =>
  BSON_TEXT[value._bsontype]?.(value) ??
  `${value._bsontype}('${String(value)}')`;

const SCALARS = {
  null: () => "null",
  number: String,
  string: quoted,
  boolean: String,
  date: (date) =>
    Number.isNaN(date.getTime())
      ? "Invalid Date"
      : `ISODate('${date.toISOString()}')`,
  objectId: (id) => `ObjectId('${String(id)}')`,
  object: (value) => (isBsonValue(value) ? bsonText(value) : "{}"),
};

const shownKeys = (value) =>
  Object.keys(value).filter((key) => value[key] !== undefined);

const writeAll = (out, [open, close], items, writeOne) => {
  if (!items.length) {
    out.push(`${open}${close}`);

    return;
  }

  out.push(`${open} `);
  items.forEach((item, n) => {
    if (n > 0) {
      out.push(", ");
    }

    writeOne(item);
  });
  out.push(` ${close}`);
};

const writeField = (out, value, charge) => (key) => {
  out.push(`${keyText(key)}: `);
  writeValue(out, value[key], charge);
};

const WRITERS = [
  [
    Array.isArray,
    (out, value, charge) =>
      writeAll(out, "[]", value, (item) => writeValue(out, item, charge)),
  ],
  [
    isOpenObject,
    (out, value, charge) =>
      writeAll(out, "{}", shownKeys(value), writeField(out, value, charge)),
  ],
];

const writeScalar = (out, value) => out.push(SCALARS[typeOf(value)](value));

const writeValue = (out, value, charge) => {
  charge?.(1);

  const [, writer = writeScalar] =
    WRITERS.find(([holds]) => Boolean(holds(value))) ?? [];

  writer(out, value, charge);
};

// A value on one line, whole, much as mongosh prints it: keys unquoted
// unless they need quotes, text always in single quotes, objects and lists
// inline. Each value visited is charged to the reader's `charge`, when it
// has one.
export const inlineOf = (value, reader = null) => {
  const out = [];

  writeValue(out, value, reader?.charge);

  return out.join("");
};

// An object's cell: its text, every key.
export const objectCellOf = (value, reader = null) => ({
  text: inlineOf(value, reader),
});
