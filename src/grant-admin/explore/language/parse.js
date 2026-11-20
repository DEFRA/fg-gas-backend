import { OBJECT_ID_HEX } from "../../../common/object-id-hex.js";
import { LITERALS, MAX_NESTING, MAX_TOKENS, VALUE_CALLS } from "./allowlist.js";
import { OUTLINE_MESSAGES } from "./outline.js";

export const MAX_LENGTH = 4000;

export const MESSAGES = {
  length: `A query is at most ${MAX_LENGTH.toLocaleString("en-GB")} characters`,
  tokens: `A query is at most ${MAX_TOKENS.toLocaleString("en-GB")} words, values and signs`,
  nesting: `Objects and lists go at most ${MAX_NESTING} deep`,
  value:
    "A value goes here: 'text', a number, /pattern/i, true, ObjectId('…'), or { … }",
  key: "A path goes here, in quotes if it has a dot",
  colon: (key) => `Add : after ${key}`,
  comma: (text) => `Add a , before “${text}”`,
  twice: (key) => `“${key}” is given twice`,
  open: (name) => `Add ( after ${name}`,
  date: (name) => `${name}('2026-10-01') takes a date in quotes`,
  close: (name) => `Close ${name}( with )`,
  extra: (text) => `I didn’t expect “${text}” here`,
  once: (name) => `Give .${name}(…) once`,
  objectId:
    "ObjectId takes 24 hex characters in quotes: ObjectId('6741a0c2e4b0f1a2b3c4d5e6')",
  objectIdNew: "Write ObjectId('…') without new",
  number: `A number goes here between -${Number.MAX_SAFE_INTEGER.toLocaleString("en-GB")} and ${Number.MAX_SAFE_INTEGER.toLocaleString("en-GB")}`,
};

class QueryError extends Error {
  constructor(message, span) {
    super(message);
    this.at = span.at;
    this.end = span.end;
  }
}

const spanOf = (token) => ({ at: token.at, end: token.end });

// The tokens, read one at a time. A failure is where its token is, or at the
// end of the text when one is missing.
const readerOf = (text, tokens) => {
  let next = 0;

  const peek = (ahead = 0) => tokens[next + ahead];
  const fail = (message, token = peek()) => {
    throw new QueryError(
      message,
      token ? spanOf(token) : { at: text.length, end: text.length + 1 },
    );
  };
  const is = (k, ahead = 0) => peek(ahead)?.k === k;
  const take = () => {
    const token = tokens[next];

    next += 1;

    return token;
  };
  const need = (k, message) => (is(k) ? take() : fail(message));

  return { peek, fail, is, take, need, done: () => next >= tokens.length };
};

// ── Values ──

const separated = (read, closer) => {
  if (read.is(",")) {
    read.take();

    return true;
  }

  if (!read.is(closer)) {
    read.fail(
      read.peek() ? MESSAGES.comma(read.peek().text) : MESSAGES.close(closer),
    );
  }

  return false;
};

const entryKey = (read) => {
  const token = read.peek();

  if (!token || !["word", "str"].includes(token.k)) {
    read.fail(MESSAGES.key);
  }

  read.take();

  return token;
};

const objectOf = (read, depth, value) => {
  const open = read.take();
  const entries = [];
  const seen = new Set();

  while (!read.is("}")) {
    const key = entryKey(read);

    if (seen.has(key.v)) {
      read.fail(MESSAGES.twice(key.v), key);
    }

    seen.add(key.v);
    read.need(":", MESSAGES.colon(key.text));
    entries.push({ key: key.v, ...spanOf(key), value: value(depth + 1) });

    if (!separated(read, "}")) {
      break;
    }
  }

  const close = read.take();

  return { type: "object", entries, at: open.at, end: close.end };
};

const arrayOf = (read, depth, value) => {
  const open = read.take();
  const items = [];

  while (!read.is("]")) {
    items.push(value(depth + 1));

    if (!separated(read, "]")) {
      break;
    }
  }

  const close = read.take();

  return { type: "array", items, at: open.at, end: close.end };
};

const dateOf = (read) => {
  const name = read.take();

  read.need("(", MESSAGES.open(name.v));

  const date = read.need("str", MESSAGES.date(name.v));
  const close = read.need(")", MESSAGES.close(name.v));

  return {
    type: "date",
    value: date.v,
    call: name.v,
    at: name.at,
    end: close.end,
    valueAt: date.at,
    valueEnd: date.end,
  };
};

// ObjectId('…') reads as its hex, lower case.
const objectIdOf = (read) => {
  const name = read.take();

  read.need("(", MESSAGES.open(name.v));

  const id = read.need("str", MESSAGES.objectId);

  if (!OBJECT_ID_HEX.test(id.v)) {
    read.fail(MESSAGES.objectId, id);
  }

  const close = read.need(")", MESSAGES.objectId);

  return {
    type: "objectId",
    value: id.v.toLowerCase(),
    at: name.at,
    end: close.end,
  };
};

const CALLS = { ISODate: dateOf, Date: dateOf, ObjectId: objectIdOf };

const isNewObjectId = (read, token) =>
  token.v === "new" &&
  read.peek(1)?.k === "word" &&
  read.peek(1).v === "ObjectId";

const SCALARS = {
  str: (token) => ({ type: "text", value: token.v }),
  // -0 is read as 0, as it travels.
  num: (token, read) =>
    Math.abs(token.v) <= Number.MAX_SAFE_INTEGER
      ? { type: "number", value: token.v + 0 }
      : read.fail(MESSAGES.number, token),
  re: (token) => ({ type: "pattern", pattern: token.v, flags: token.flags }),
};

const wordValue = (read, token) => {
  if (LITERALS.has(token.v)) {
    read.take();

    return { type: "literal", value: LITERALS.get(token.v), ...spanOf(token) };
  }

  if (isNewObjectId(read, token)) {
    read.fail(MESSAGES.objectIdNew);
  }

  return VALUE_CALLS.has(token.v)
    ? CALLS[token.v](read)
    : read.fail(MESSAGES.value);
};

const valueReader = (read) => {
  const value = (depth) => {
    const token = read.peek();

    if (!token) {
      return read.fail(MESSAGES.value);
    }

    return valueOfToken(read, token, depth, value);
  };

  return value;
};

// Depth is counted by the objects and lists that open, not by the values.
const containerOf = (read, depth, value, nested) =>
  depth > MAX_NESTING
    ? read.fail(MESSAGES.nesting)
    : nested(read, depth, value);

const valueOfToken = (read, token, depth, value) => {
  if (Object.hasOwn(SCALARS, token.k)) {
    read.take();

    return { ...SCALARS[token.k](token, read), ...spanOf(token) };
  }

  const nested = { "{": objectOf, "[": arrayOf }[token.k];

  if (nested) {
    return containerOf(read, depth, value, nested);
  }

  return token.k === "word"
    ? wordValue(read, token)
    : read.fail(MESSAGES.value);
};

// ── The call chain ──

const argumentsOf = (read, name, value) => {
  read.need("(", MESSAGES.open(name));

  const args = [];

  while (!read.is(")")) {
    args.push(value(1));

    if (!separated(read, ")")) {
      break;
    }
  }

  return { args, close: read.take() };
};

// After the first call, only a chained one; the outline names a wrong word.
const callOf = (read, value, seen) => {
  read.take();

  const name = read.need(
    "word",
    seen.size ? OUTLINE_MESSAGES.chained : OUTLINE_MESSAGES.method,
  );

  if (seen.has(name.v)) {
    read.fail(MESSAGES.once(name.v), name);
  }

  seen.add(name.v);

  const { args, close } = argumentsOf(read, name.v, value);

  return { name: name.v, at: name.at, end: name.end, args, close: close.end };
};

const checkSize = (text, tokens) => {
  if (text.length > MAX_LENGTH) {
    throw new QueryError(MESSAGES.length, { at: MAX_LENGTH, end: text.length });
  }

  if (tokens.length > MAX_TOKENS) {
    throw new QueryError(MESSAGES.tokens, spanOf(tokens[MAX_TOKENS]));
  }
};

const treeOf = (text, tokens) => {
  const read = readerOf(text, tokens);
  const value = valueReader(read);
  const db = read.take();

  read.take();

  const source = read.take();
  const calls = [];
  const seen = new Set();

  while (read.is(".")) {
    calls.push(callOf(read, value, seen));
  }

  if (read.is(";")) {
    read.take();
  }

  if (!read.done()) {
    read.fail(MESSAGES.extra(read.peek().text));
  }

  return {
    source: { name: source.v, ...spanOf(source) },
    calls,
    at: db.at,
    end: tokens.at(-1).end,
  };
};

// Tokens to the query's literal tree, read and never evaluated: objects are
// ordered entry lists, and every node keeps where it is. Or the first
// failure as { message, at, end }. The shape is checked first (outline.js).
export const parse = (text, allTokens) => {
  const tokens = allTokens.filter(({ k }) => k !== "comment");

  try {
    checkSize(text, tokens);

    return { tree: treeOf(text, tokens) };
  } catch (error) {
    if (!(error instanceof QueryError)) {
      throw error;
    }

    return { error: { message: error.message, at: error.at, end: error.end } };
  }
};

// A text or token count over the limits, as { message, at, end }, or null.
export const sizeProblem = (text, allTokens) => {
  try {
    checkSize(
      text,
      allTokens.filter(({ k }) => k !== "comment"),
    );

    return null;
  } catch (error) {
    return { message: error.message, at: error.at, end: error.end };
  }
};
