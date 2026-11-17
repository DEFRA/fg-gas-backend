import { setImmediate } from "node:timers/promises";
import { isDecimalTag } from "./evaluate-read.js";
import { MAX_CELL_DEPTH } from "./evaluate.js";
import { MAX_LIMIT, partSchema } from "./query-schema.js";

// Rows are checked by hand, a few hundred between turns of the event loop:
// Joi takes too long over thousands of them at once.
const CHUNK = 500;

const isPlain = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isScalar = (value) =>
  typeof value === "string" ||
  (typeof value === "number" && Number.isFinite(value));

// A list inside a list as deep as a cell keeps them, the outermost at 0.
const isListCell = (value, depth) =>
  Array.isArray(value) &&
  depth < MAX_CELL_DEPTH &&
  value.every((item) => isCell(item, depth + 1));

// An object, as the text that shows it.
const isObjectCell = (value) =>
  isPlain(value) &&
  Object.keys(value).length === 1 &&
  typeof value.text === "string";

const isValueCell = (value) =>
  value === null || isScalar(value) || isObjectCell(value);

const isCell = (value, depth = 0) =>
  isValueCell(value) || isListCell(value, depth);

const ORDERED_TAGS = {
  c: (value) => value === true,
  x: (text) => isDecimalTag(text),
  n: (text) => ["NaN", "Infinity", "-Infinity"].includes(text),
  b: (value) => typeof value === "boolean",
  d: (text) => isText(text) && !Number.isNaN(Date.parse(text)),
  o: (hex) => isText(hex) && /^[0-9a-f]{24}$/i.test(hex),
  k: (entries, depth) =>
    Array.isArray(entries) &&
    entries.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        isText(entry[0]) &&
        isOrdered(entry[1], depth + 1),
    ),
};

const isTagged = (value, depth) => {
  const tags = Object.keys(value);

  return (
    tags.length === 1 &&
    Object.hasOwn(ORDERED_TAGS, tags[0]) &&
    ORDERED_TAGS[tags[0]](value[tags[0]], depth)
  );
};

const isNested = (value, depth) =>
  Array.isArray(value)
    ? value.every((item) => isOrdered(item, depth + 1))
    : isPlain(value) && isTagged(value, depth);

// A value sent typed (evaluate.js orderedOf), as deep as a cell keeps lists.
const isLeaf = (value) => value === null || isScalar(value);

const isOrdered = (value, depth = 0) =>
  isLeaf(value) || (depth < MAX_CELL_DEPTH * 2 && isNested(value, depth));

export const hasCells = (cells) =>
  isPlain(cells) && Object.values(cells).every((cell) => isCell(cell));

const invalid = (path, type) =>
  Object.assign(new Error("Explore answer cannot be read"), {
    details: [{ path, type }],
  });

const isList = (items) => Array.isArray(items) && items.length <= MAX_LIMIT * 4;

const pause = (at) =>
  at % CHUNK === CHUNK - 1 ? setImmediate() : Promise.resolve();

// Each item checked by `holds`, with a turn for others every few hundred.
export const checkEach = async (items, holds, path) => {
  if (!isList(items)) {
    throw invalid(path, "array");
  }

  for (let at = 0; at < items.length; at += 1) {
    if (!holds(items[at])) {
      throw invalid([...path, at], "item");
    }

    await pause(at);
  }
};

const isText = (value) => typeof value === "string";

const isKey = (key) =>
  isPlain(key) && isOptional(isText)(key.t) && isText(key.i);

const isOptional = (holds) => (value) => value === null || holds(value);

const isRowOf = (row) =>
  [
    isKey(row.key),
    isOptional(isPlain)(row.open),
    hasCells(row.cells),
    isOrdered(row.order),
  ].every(Boolean);

const isPartRow = (row) => isPlain(row) && isRowOf(row);

const hasPartials = (aggs) =>
  isPlain(aggs) && Object.values(aggs).every((value) => isOrdered(value));

const isGroupOf = (group) =>
  [
    isOptional(isScalar)(group.key),
    isOrdered(group.value),
    Number.isInteger(group.n),
    hasPartials(group.aggs),
  ].every(Boolean);

const isGroup = (group) => isPlain(group) && isGroupOf(group);

const shellOf = (part) => ({
  ...part,
  boxes: Array.isArray(part.boxes)
    ? part.boxes.map((box) => ({ ...box, rows: [] }))
    : part.boxes,
  groups: Array.isArray(part.groups) ? [] : part.groups,
});

const checkRows = (part) =>
  Promise.all(
    part.boxes.map((box, n) =>
      checkEach(box.rows, isPartRow, ["boxes", n, "rows"]),
    ),
  );

// One service's part, checked as `partSchema` says, its rows and groups by
// hand. Throws as Joi does, naming the path and the rule.
export const checkPart = async (part, options = {}) => {
  const { error, value } = partSchema.validate(shellOf(part), options);

  if (error) {
    throw error;
  }

  await checkRows(part);

  if (Array.isArray(part.groups)) {
    await checkEach(part.groups, isGroup, ["groups"]);
  }

  return {
    ...value,
    boxes: value.boxes.map((box, n) => ({ ...box, rows: part.boxes[n].rows })),
    groups: part.groups,
  };
};
