import { createHash } from "node:crypto";
import { jsonKindOf, withJsonNumbers } from "./plain-json.js";

// Enough to say what an edit touched without the audit event growing with it.
export const CHANGED_PATHS_MAX = 50;

// RFC 6901: `~` first, so the `~1` written for `/` is not escaped again.
const escapeSegment = (segment) =>
  String(segment).replaceAll("~", "~0").replaceAll("/", "~1");

const pointer = (segments) =>
  segments.map((segment) => `/${escapeSegment(segment)}`).join("");

const isContainer = (kind) => kind === "array" || kind === "object";

// A BSON value is compared by its JSON text; an edit can only ever send that.
const sameLeaf = (kind, before, after) =>
  kind === "other"
    ? JSON.stringify(before) === JSON.stringify(after)
    : before === after;

// Own keys only, so `__proto__`, `constructor` and `toString` are ordinary keys.
const childKeys = (kind, before, after) => {
  if (kind === "array") {
    return Array.from(
      { length: Math.max(before.length, after.length) },
      (_, index) => index,
    );
  }

  return [...new Set([...Object.keys(before), ...Object.keys(after)])];
};

const visitChild = (before, after, path, found) => {
  const key = path.at(-1);

  if (Object.hasOwn(before, key) && Object.hasOwn(after, key)) {
    walk(before[key], after[key], path, found);
  } else {
    found.push(pointer(path));
  }
};

const walkChildren = (kind, before, after, segments, found) => {
  for (const key of childKeys(kind, before, after)) {
    if (found.length > CHANGED_PATHS_MAX) {
      return;
    }

    visitChild(before, after, [...segments, key], found);
  }
};

// A changed type is reported at its own path rather than walked into.
const walk = (before, after, segments, found) => {
  const kind = jsonKindOf(before);

  if (kind !== jsonKindOf(after)) {
    found.push(pointer(segments));
    return;
  }

  if (isContainer(kind)) {
    walkChildren(kind, before, after, segments, found);
    return;
  }

  if (!sameLeaf(kind, before, after)) {
    found.push(pointer(segments));
  }
};

/**
 * Where two payloads differ, as JSON Pointers - never the values. One path
 * past the cap is enough to know the list was cut.
 */
export const payloadChanges = (before, after) => {
  const found = [];

  walk(before, after, [], found);

  return {
    changedPaths: found.slice(0, CHANGED_PATHS_MAX),
    changedPathsTruncated: found.length > CHANGED_PATHS_MAX,
  };
};

// Of the JSON the editor is given, so an untouched BSON number hashes as its text.
export const payloadHash = (payload) =>
  createHash("sha256")
    .update(JSON.stringify(withJsonNumbers(payload)))
    .digest("hex");
