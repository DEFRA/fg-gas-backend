import jsonata from "jsonata";

const JSONATA_PREFIX = "jsonata:";

// "$." addresses the page context (the agreement), "@." the item currently being
// repeated over. Both are evaluated as JSONata, with the item bound to $row, so
// repeated content can reach agreement-level data as well as its own row.
// Trailing sentence punctuation falls outside the pattern, because a step only
// continues when the dot is followed by an identifier: "... $.agreement.sbi."
// resolves the reference and keeps the full stop.
const refPattern = /[$@]\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*/g;

const findRefs = (value) => value.match(refPattern) ?? [];

const isJsonataExpression = (value) => value.startsWith(JSONATA_PREFIX);

// A lone reference is the value it points at, keeping its type. Anything more
// than that — arithmetic, a "??" fallback, a comparison — has to say so with
// the "jsonata:" prefix, because a string like "$.price * $.quantity" is
// otherwise indistinguishable from prose that mentions two references.
const isValueRef = (value, refs) => refs.length === 1 && refs[0] === value;

// Only a "@." that opens a term is a row reference. One inside a string literal
// ("a@.b") belongs to the literal and is left alone.
const rowRefPattern = /(^|[^\w'"@$])@\./g;

const toExpression = (value) =>
  value.replace(rowRefPattern, (_, prefix) => `${prefix}$row.`);

const evaluate = async (expression, { context, row }) => {
  const compiled = jsonata(toExpression(expression));

  if (row !== undefined) {
    compiled.assign("row", row);
  }

  return compiled.evaluate(context);
};

const requireResolved = (resolved, reference) => {
  if (resolved === undefined) {
    throw new Error(`Unresolved reference "${reference}"`);
  }

  return resolved;
};

// A reference used in text has to produce text. Rendering an object would put
// "[object Object]" on the page, so it fails instead.
const toText = (value, reference) => {
  if (value === null) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map((item) => toText(item, reference)).join(" ");
  }

  if (typeof value === "object") {
    throw new Error(
      `Reference "${reference}" resolves to an object and cannot be used in text`,
    );
  }

  return String(value);
};

const interpolate = async (value, scope) => {
  const refs = findRefs(value);
  const resolved = await Promise.all(
    refs.map(async (ref) =>
      toText(requireResolved(await evaluate(ref, scope), ref), ref),
    ),
  );
  const text = new Map(refs.map((ref, index) => [ref, resolved[index]]));

  return value.replace(refPattern, (ref) => text.get(ref));
};

const resolveString = async (value, scope) => {
  if (isJsonataExpression(value)) {
    const expression = value.slice(JSONATA_PREFIX.length);

    return requireResolved(await evaluate(expression, scope), value);
  }

  const refs = findRefs(value);

  if (refs.length === 0) {
    return value;
  }

  return isValueRef(value, refs)
    ? requireResolved(await evaluate(value, scope), value)
    : interpolate(value, scope);
};

const isPlainObject = (value) => value !== null && typeof value === "object";

const resolveObject = async (value, scope) => {
  const entries = await Promise.all(
    Object.entries(value).map(async ([key, item]) => [
      key,
      await resolveRefs(item, scope),
    ]),
  );

  return Object.fromEntries(entries);
};

export const resolveRefs = async (value, scope) => {
  if (typeof value === "string") {
    return resolveString(value, scope);
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveRefs(item, scope)));
  }

  if (isPlainObject(value)) {
    return resolveObject(value, scope);
  }

  return value;
};

const isTruthy = (value) =>
  Array.isArray(value) ? value.length > 0 && Boolean(value[0]) : Boolean(value);

export const resolveCondition = async (condition, scope) => {
  const expression = isJsonataExpression(condition)
    ? condition.slice(JSONATA_PREFIX.length)
    : condition;

  return isTruthy(await evaluate(expression, scope));
};
