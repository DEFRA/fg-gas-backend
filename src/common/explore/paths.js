export const MAX_PATH_LENGTH = 200;
const MAX_SEGMENTS = 12;

export const normalisedName = (name) => name.toLowerCase().replace(/[_-]/g, "");

// Names every object inherits: never a segment of a path.
const INHERITED = new Set(["__proto__", "constructor", "prototype"]);

const SEGMENT = /^[A-Za-z0-9_-]+$/;

// Never read, at any depth: identity, secrets and service addresses a support
// query has no need to look for by value. Names are compared without case,
// "_" or "-", so `sort_code` is `sortCode`.
const DENIED_NAMES = new Set(
  [
    "bank",
    "sortCode",
    "accountNumber",
    "iban",
    "nationalInsuranceNumber",
    "nino",
    "dateOfBirth",
    "password",
    "secret",
    "token",
    "accessToken",
    "apiKey",
    "ip",
    "url",
    "internalUrl",
    "claimsUrl",
    "s3Key",
    "s3Bucket",
  ].map((name) => normalisedName(name)),
);

export const isDeniedName = (name) =>
  DENIED_NAMES.has(normalisedName(name)) || name.startsWith("_");

const isSegment = (name) => SEGMENT.test(name) && !INHERITED.has(name);

const segmentsOf = (text) =>
  typeof text === "string" && text.length <= MAX_PATH_LENGTH
    ? text.split(".")
    : [];

const isWellFormed = (names) =>
  names.length > 0 && names.length <= MAX_SEGMENTS && names.every(isSegment);

export const MALFORMED = "MALFORMED";
export const DENIED = "DENIED";
export const NOT_A_ROOT = "NOT_A_ROOT";

const problemOfSegments = (names) => {
  if (!isWellFormed(names)) {
    return MALFORMED;
  }

  return names.some(isDeniedName) ? DENIED : null;
};

// A stored path's segments, as Mongo names them, none denied or inherited; a
// segment of digits is a list's position. Null for anything else.
export const parsePath = (text) => {
  const names = segmentsOf(text);

  return problemOfSegments(names) ? null : names;
};

const startsWith = (names, prefix) =>
  prefix.length <= names.length && prefix.every((name, n) => names[n] === name);

const isBelow = (names, root) => startsWith(names, root.split("."));

const RULES = [
  (names) => problemOfSegments(names),
  (names, { roots }) =>
    roots.some((root) => isBelow(names, root)) ? null : NOT_A_ROOT,
];

// Why a source may not read a path, or null when it may: well formed, at or
// below one of its roots, nothing in it denied.
export const pathProblem = (text, lists) => {
  const names = segmentsOf(text);

  for (const rule of RULES) {
    const problem = rule(names, lists);

    if (problem) {
      return problem;
    }
  }

  return null;
};
