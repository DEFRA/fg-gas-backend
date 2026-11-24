import Joi from "joi";
import { MAX_KEY_LENGTH } from "../buckets/error-key.js";
import { isDecimalTag } from "./evaluate-read.js";
import { isDateText } from "./evaluate.js";
import { MAX_PATTERN_LENGTH, usablePatterns } from "./pattern.js";
import { MAX_PATH_LENGTH, parsePath } from "./paths.js";

export const QUERY_VERSION = 4;

export const OPS = [
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "regex",
  "in",
  "nin",
  "empty",
  "filled",
];
export const FUNCTIONS = ["count", "sum", "min", "max"];
export const TYPES = ["text", "number", "boolean", "date", "objectId"];
export const MODES = ["rows", "groups", "count", "distinct"];
export const DOCUMENTS_MODE = "documents";

export const MAX_COLUMNS = 20;
export const MAX_TESTS = 30;
export const MAX_VALUES = 50;
export const MAX_VALUE_LENGTH = 200;
export const MAX_DEPTH = 8;
export const MAX_LIMIT = 5000;
export const MAX_UNWINDS = 4;

// The cells one answer may hold, columns × rows: more can't be shaped and
// sent without holding the service.
export const MAX_CELLS = 20_000;

// The most rows one answer holds for its columns.
export const rowCapOf = (columns) =>
  Math.min(MAX_LIMIT, Math.floor(MAX_CELLS / columns.length));

const MIB = 1024 * 1024;

// The largest document mongod stores.
export const MAX_DOCUMENT_BYTES = 16 * MIB;

// An answer of exactly one row may print its document up to these.
export const ONE_DOCUMENT_ALLOWANCE = Object.freeze({
  bytes: 16 * MIB,
  values: 250_000,
});

// The cells one page draws: each cell's text up to its first
// DRAWN_CELL_LENGTH code points, near as GPA draws it (a longer one shows
// only its start).
export const CELLS_ALLOWANCE = 2 * MIB;
export const DRAWN_CELL_LENGTH = 1000;

// The JSON of the cells one page holds whole, its rows' sort values with
// them, whatever they draw.
export const CELLS_HELD_BYTES = 8 * MIB;

// The bytes one download holds, CSV or JSON.
export const DOWNLOAD_BYTES = 256 * MIB;
const MAX_LISTED_PATHS = 2000;

// Error keys are cut by code points (error-key.js), so a key may be longer
// in UTF-16 than any other value.
const KEY_PATHS = new Set(["errorKey"]);

// Whether text is longer than a test on its path may compare. A key of
// MAX_KEY_LENGTH code points is at most twice as long in UTF-16.
export const isTooLong = (path, text) =>
  KEY_PATHS.has(path)
    ? text.length > 2 * MAX_KEY_LENGTH || [...text].length > MAX_KEY_LENGTH
    : text.length > MAX_VALUE_LENGTH;

export const maxLengthOf = (path) =>
  KEY_PATHS.has(path) ? MAX_KEY_LENGTH : MAX_VALUE_LENGTH;

const LIST_OPS = ["in", "nin"];
const MAX_AS = 64;
const MAX_KNOWN_VALUES = 200;
const BARE_OPS = ["empty", "filled"];

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const BOX = /^[a-z]+\.[a-z][a-z0-9-]*$/;

const name = Joi.string().pattern(NAME);
const pathText = Joi.string().max(MAX_PATH_LENGTH);

const INVALID = "any.invalid";

const assertPath = (text, helpers) =>
  parsePath(text) === null ? helpers.error(INVALID) : text;

// A stored path, well formed: `_id`, or segments of a key's characters, a
// key starting $ after the first.
const storedPath = pathText.custom(assertPath);

// A date names a real day and time, so it always has an instant.
const realDate = Joi.string().custom((text, helpers) =>
  isDateText(text) ? text : helpers.error(INVALID),
);

// Text is as long as its path allows (isTooLong), checked with the test.
const testValue = Joi.alternatives(
  Joi.string().allow(""),
  Joi.number(),
  Joi.boolean(),
  Joi.object({ date: realDate.required() }),
  Joi.object({
    oid: Joi.string()
      .pattern(/^[0-9a-f]{24}$/)
      .required(),
  }),
).allow(null);

// Its limits are the matcher's own: CW checks them again when it compiles it.
const pattern = Joi.object({
  pattern: Joi.string().max(MAX_PATTERN_LENGTH).allow("").required(),
  flags: Joi.string()
    .pattern(/^[imsu]{0,4}$/)
    .allow("")
    .required(),
});

const valueCount = (op) => {
  if (BARE_OPS.includes(op)) {
    return [0, 0];
  }

  return LIST_OPS.includes(op) ? [1, MAX_VALUES] : [1, 1];
};

const isLongText = (path) => (value) =>
  typeof value === "string" && isTooLong(path, value);

const assertValues = (asked, helpers) => {
  const [least, most] = valueCount(asked.op);
  const given = asked.values.length;

  if (given < least || given > most) {
    return helpers.error(INVALID);
  }

  return asked.values.some(isLongText(asked.path))
    ? helpers.error(INVALID)
    : asked;
};

const regexTest = Joi.object({
  path: storedPath.required(),
  op: Joi.string().valid("regex").required(),
  values: Joi.array().items(pattern).length(1).required(),
});

const valueTest = Joi.object({
  path: storedPath.required(),
  op: Joi.string()
    .valid(...OPS.filter((op) => op !== "regex"))
    .required(),
  values: Joi.array().items(testValue).max(MAX_VALUES).required(),
}).custom(assertValues);

const test = Joi.alternatives(regexTest, valueTest);

const condition = Joi.link("#condition");

const where = Joi.alternatives(
  Joi.object({
    all: Joi.array().items(condition).min(1).max(MAX_TESTS).required(),
  }),
  Joi.object({
    any: Joi.array().items(condition).min(1).max(MAX_TESTS).required(),
  }),
  Joi.object({ not: condition.required() }),
  test,
).id("condition");

// "*" is counted, never read: only count(*) names it.
const starOrPath = Joi.when("fn", {
  is: "count",
  then: Joi.alternatives(storedPath, Joi.string().valid("*")),
  otherwise: storedPath,
}).required();

const column = Joi.object({
  fn: Joi.string().valid(...FUNCTIONS),
  path: starOrPath,
  as: Joi.string().min(1).max(MAX_AS),
});

const pathRef = Joi.object({ path: storedPath.required() });
const GROUPED = ["groups", "distinct"];
const COUNTED = Joi.object({
  fn: Joi.string().valid("count").required(),
  path: Joi.string().valid("*").required(),
});

const orderBy = Joi.object({
  path: starOrPath,
  fn: Joi.string()
    .valid(...FUNCTIONS)
    .allow(null)
    .required(),
  desc: Joi.boolean().required(),
});

const cursor = Joi.string().max(MAX_PATH_LENGTH).allow(null);

const unwindStep = Joi.object({
  path: storedPath.required(),
  preserve: Joi.boolean().strict().required(),
});

// $unwind makes rows of a record's list, for rows and groups only.
const UNWOUND = ["rows", "groups"];

// What a document is, for the query's projection: the record whole (no
// projection) or as projected, with `_id` or without (`_id: 0`); and in the
// `starts` mode, that only each record's start is sent (document-start.js).
// A `documents` fetch of whole documents also says the bytes it may send in
// all.
export const STARTS = "starts";

const shape = {
  whole: Joi.boolean().required(),
  id: Joi.boolean().required(),
  mode: Joi.valid(STARTS),
};

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

// A record's `_id` as the BSON of { _id }, typed: at most what an index key
// holds.
const MAX_ID_TEXT = 1400;

export const idText = Joi.string().max(MAX_ID_TEXT).pattern(BASE64);

const MAX_BOX_LENGTH = 64;
const KIB = 1024;
const UNWIND_POSITION_BYTES = 21;

// A `documents` fetch's row as JSON at most: its box, its `_id` and a
// position of up to 20 characters at each unwind, with their keys.
const FETCH_ROW_BYTES =
  MAX_BOX_LENGTH + MAX_ID_TEXT + MAX_UNWINDS * UNWIND_POSITION_BYTES + 32;

// The most a Query's body takes: a Query, and a `documents` fetch's rows
// beside it.
export const MAX_QUERY_BYTES = 1024 * KIB + MAX_LIMIT * FETCH_ROW_BYTES;

const positionsAt = Joi.array()
  .items(Joi.number().integer().min(0).allow(null))
  .max(MAX_UNWINDS);

const fetchRow = Joi.object({
  box: Joi.string().max(MAX_BOX_LENGTH).pattern(BOX).required(),
  id: idText.required(),
  at: positionsAt.required(),
});

const documentsOf = Joi.when("mode", {
  is: DOCUMENTS_MODE,
  then: Joi.object({
    ...shape,
    bytes: Joi.when("mode", {
      is: STARTS,
      then: Joi.forbidden(),
      otherwise: Joi.number().integer().min(1).max(DOWNLOAD_BYTES).required(),
    }),
  }).required(),
  otherwise: Joi.object(shape),
});

export const querySchema = Joi.object({
  v: Joi.number().valid(QUERY_VERSION).required(),
  source: name.required(),
  mode: Joi.string()
    .valid(...MODES, DOCUMENTS_MODE)
    .required(),
  documents: documentsOf,
  cellBytes: Joi.number().integer().min(1).max(DOWNLOAD_BYTES),
  // A `documents` fetch: the rows whose documents it sends, by box.
  rows: Joi.when("mode", {
    is: DOCUMENTS_MODE,
    then: Joi.array().items(fetchRow).max(Joi.ref("limit")).required(),
    otherwise: Joi.forbidden(),
  }),
  columns: Joi.alternatives().conditional("mode", {
    is: "count",
    then: Joi.array().items(COUNTED).length(1).required(),
    otherwise: Joi.array().items(column).min(1).max(MAX_COLUMNS).required(),
  }),
  where: where.allow(null).required(),
  unwind: Joi.alternatives().conditional("mode", {
    is: Joi.valid(...UNWOUND, DOCUMENTS_MODE),
    then: Joi.array().items(unwindStep).max(MAX_UNWINDS).required(),
    otherwise: Joi.array().length(0).required(),
  }),
  // Groups and distinct values group by a path; rows and a count don't.
  groupBy: Joi.alternatives().conditional("mode", {
    is: Joi.valid(...GROUPED),
    then: pathRef.required(),
    otherwise: Joi.valid(null).required(),
  }),
  orderBy: orderBy.allow(null).required(),
  limit: Joi.number().integer().min(1).max(MAX_LIMIT).required(),
  positions: Joi.object().pattern(BOX, cursor).allow(null).required(),
  window: Joi.boolean(),
}).label("ExploreQuery");

const BRANCHES = {
  all: (node) => node.all,
  any: (node) => node.any,
  not: (node) => [node.not],
};

// The conditions directly under a node: none for a test.
export const childrenOf = (node) => {
  const branch = Object.keys(BRANCHES).find((kind) =>
    Object.hasOwn(node, kind),
  );

  return branch ? BRANCHES[branch](node) : [];
};

const leavesOf = (node) => {
  const below = childrenOf(node);

  return below.length ? below.flatMap(leavesOf) : [node];
};

const depthOf = (node) => {
  const below = childrenOf(node);

  return below.length ? 1 + Math.max(...below.map(depthOf)) : 0;
};

export const testsOf = (node) => (node ? leavesOf(node) : []);

// Joi checks each part; a WHERE's size and depth, and that each pattern is
// one the matcher takes, are checked here.
export const isWithinLimits = (query) =>
  testsOf(query.where).length <= MAX_TESTS &&
  (query.where ? depthOf(query.where) : 0) <= MAX_DEPTH &&
  usablePatterns(testsOf(query.where));

const key = Joi.object({
  t: Joi.string().allow(null).required(),
  i: Joi.string().required(),
});

// A list inside a list is shown as stored, whole.
const cell = Joi.alternatives(
  Joi.string().allow(""),
  Joi.number(),
  Joi.object({ text: Joi.string().required() }),
  Joi.array().items(Joi.link("#cell")),
)
  .allow(null)
  .id("cell");

// A value sent with its type, for sorting, merging and a group's document
// (evaluate.js orderedOf).
const ordered = Joi.alternatives(
  Joi.string().allow(""),
  Joi.number(),
  Joi.array().items(Joi.link("#ordered")),
  Joi.object({
    n: Joi.string().valid("NaN", "Infinity", "-Infinity").required(),
  }),
  Joi.object({ b: Joi.boolean().required() }),
  Joi.object({
    x: Joi.string()
      .custom((text, helpers) =>
        isDecimalTag(text) ? text : helpers.error("any.invalid"),
      )
      .required(),
  }),
  Joi.object({ d: Joi.string().isoDate().required() }),
  Joi.object({ o: Joi.string().hex().length(24).required() }),
  Joi.object({ i: Joi.number().integer().required() }),
  Joi.object({
    f: Joi.alternatives(
      Joi.number(),
      Joi.string().valid("NaN", "Infinity", "-Infinity", "-0"),
    ).required(),
  }),
  Joi.object({
    l: Joi.string()
      .pattern(/^-?\d{1,19}$/)
      .required(),
  }),
  Joi.object({ e: Joi.string().pattern(BASE64).required() }),
  Joi.object({
    k: Joi.array()
      .items(Joi.array().ordered(Joi.string().allow(""), Joi.link("#ordered")))
      .required(),
  }),
)
  .allow(null)
  .id("ordered");

// A record's row: what it shows, and its typed `_id`, unwind positions and
// BSON size, by which its document is fetched.
const row = Joi.object({
  key: key.required(),
  open: Joi.object().unknown(true).allow(null).required(),
  cells: Joi.object().pattern(Joi.string(), cell).required(),
  order: ordered.required(),
  id: idText,
  at: positionsAt,
  size: Joi.number().integer().min(0).max(MAX_DOCUMENT_BYTES).allow(null),
});

const skippedRecord = Joi.object({
  open: Joi.object().unknown(true).allow(null).required(),
  id: idText.required(),
});

const count = Joi.object({
  n: Joi.number().integer().min(0).required(),
  capped: Joi.boolean().required(),
});

const box = Joi.object({
  id: Joi.string().pattern(BOX).required(),
  rows: Joi.array().items(row).max(MAX_LIMIT).required(),
  to: key.allow(null).required(),
  end: Joi.boolean().required(),
  count: count.allow(null).required(),
  // A window that ran out of work and ended early, at `to`, and the records
  // in it too large to search at all, skipped.
  partial: Joi.boolean(),
  // Ended early by the cells allowance rather than out of work.
  cut: Joi.boolean(),
  skipped: Joi.array().items(skippedRecord).max(MAX_LIMIT),
});

const group = Joi.object({
  key: Joi.alternatives(Joi.string().allow(""), Joi.number())
    .allow(null)
    .required(),
  value: ordered.required(),
  n: Joi.number().integer().min(0).required(),
  aggs: Joi.object().pattern(Joi.string(), ordered).required(),
});

// Where a row stands in the Query's order, across the boxes.
const rowAt = Joi.object({
  key: key.keys({ box: Joi.string().pattern(BOX).required() }).required(),
  order: ordered.required(),
});

// One service's part of a run: rows per box, and the groups it counted. A
// download's exact read cut by its cells allowance says where its last row
// stands (`cutAfter`).
export const partSchema = Joi.object({
  read: Joi.string().valid("exact", "windowed", "full").required(),
  boxes: Joi.array().items(box).required(),
  groups: Joi.array().items(group).allow(null).required(),
  cutAfter: Joi.when("read", {
    is: "windowed",
    then: Joi.forbidden(),
    otherwise: rowAt,
  }),
}).label("ExplorePart");

const knownPath = Joi.object({
  path: storedPath.required(),
  type: Joi.string().valid(...TYPES),
  index: Joi.string()
    .valid("fact", "ref", "refs", "time", "box", "id")
    .allow(null)
    .required(),
  closed: Joi.boolean().required(),
  within: pathText.allow(null).required(),
  // For a ref: the index scans one value of it takes.
  scans: Joi.number().integer().min(1),
  // For a time: how its bucket stores it.
  stored: Joi.string().valid("date", "isoString"),
  values: Joi.array()
    .items(
      Joi.object({
        value: Joi.alternatives(Joi.string(), Joi.number()).required(),
        label: Joi.string(),
      }),
    )
    .max(MAX_KNOWN_VALUES),
});

// Fields this release no longer reads, from a service on an older one, are
// ignored: `roots` among them.
const source = Joi.object({
  name: name.required(),
  label: Joi.string().required(),
  service: Joi.string().required(),
  size: Joi.string().valid("big", "small").required(),
  noun: Joi.object({
    one: Joi.string().required(),
    many: Joi.string().required(),
  }).required(),
  star: Joi.array().items(pathText).required(),
  time: pathText.allow(null).required(),
  answersAt: pathText.allow(null).required(),
  paths: Joi.array().items(knownPath).max(MAX_LISTED_PATHS).required(),
}).unknown(true);

// What a service can be asked: its sources.
export const sourcesSchema = Joi.object({
  sources: Joi.array().items(source).required(),
}).label("ExploreSources");
