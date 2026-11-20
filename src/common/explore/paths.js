export const MAX_PATH_LENGTH = 200;
const MAX_SEGMENTS = 12;

// Names every object inherits: never a segment of a path.
const INHERITED = new Set(["__proto__", "constructor", "prototype"]);

const SEGMENT = /^[A-Za-z0-9_-]+$/;

// A stored key such as JSON Schema's $schema. Never a path's first segment,
// which a filter reads as an operator.
const DOLLAR_SEGMENT = /^\$[A-Za-z0-9_-]+$/;

export const isDollarSegment = (name) => DOLLAR_SEGMENT.test(name);

export const hasDollarSegment = (path) => path.split(".").some(isDollarSegment);

const isSegment = (name, n) =>
  (SEGMENT.test(name) && !INHERITED.has(name)) ||
  (n > 0 && isDollarSegment(name));

const segmentsOf = (text) =>
  typeof text === "string" && text.length <= MAX_PATH_LENGTH
    ? text.split(".")
    : [];

const isWellFormed = (names) =>
  names.length > 0 && names.length <= MAX_SEGMENTS && names.every(isSegment);

export const MALFORMED = "MALFORMED";

// A stored path's segments, as Mongo names them, none inherited; a segment
// of digits is a list's position. Null for anything else.
export const parsePath = (text) => {
  const names = segmentsOf(text);

  return isWellFormed(names) ? names : null;
};

// Why a path can't be read, or null when it can: every well-formed path of
// a source is readable.
export const pathProblem = (text) =>
  parsePath(text) === null ? MALFORMED : null;
