import { MALFORMED } from "../../../common/explore/paths.js";
import {
  MAX_COLUMNS,
  MAX_LIMIT,
  MAX_TESTS,
  MAX_UNWINDS,
  MAX_VALUES,
  maxLengthOf,
} from "../../../common/explore/query-schema.js";
import { FILTER_OPS, OPERATORS, MAX_STAGES } from "./allowlist.js";
import { OUTLINE_MESSAGES, listOf } from "./outline.js";

export const MAX_NAME = 64;

export const READ_MESSAGES = {
  [MALFORMED]: (path) =>
    `“${path}” isn’t a path: names of letters, digits, _ and - joined by dots, as 'identifiers.sbi', any but the first may start with $`,
  ref: (what) =>
    `${what} takes a path as '$path', e.g. '$phases.answers.parcels.parcelId'`,
  filter: "A filter is an object: { path: value }",
  emptyFilter: "A filter in a list names a path: { currentStatus: 'RECEIVED' }",
  logic: (key) => `${key} takes a list of filters: [{ … }, { … }]`,
  notHere: (key) =>
    `“${key}” isn’t allowed here. Use $and, $or, $nor, or a path`,
  notAnOp: (key) =>
    `“${key}” isn’t allowed here. Use ${listOf([...FILTER_OPS.keys()].filter((op) => op !== "$options"))}`,
  list: (name) => `A list needs $in: { ${name}: { $in: [ … ] } }`,
  inList: (key) => `${key} takes a list: ['a', 'b']`,
  value:
    "A value goes here: 'text', a number, true, false, null, ISODate('2026-10-01') or ObjectId('…')",
  compared:
    "Compare with text, a number, true, false, ISODate('2026-10-01') or ObjectId('…')",
  exists: "$exists takes true or false: { $exists: true }",
  regex: "$regex takes a pattern: /hill/i or 'hill'",
  options: "$options goes with $regex: { $regex: 'hill', $options: 'i' }",
  optionsText: "$options takes flags in quotes: 'i'",
  flagsTwice: "Give the flags once: /hill/i or $options: 'i'",
  not: "$not takes a test or a pattern: { $not: { $gt: 4 } } or { $not: /hill/ }",
  date: "A date goes here, in quotes, in UTC: '2026-10-01'",
  dateStored: (path) =>
    `${path} is stored as a date: compare it with ISODate('2026-10-01')`,
  objectIdStored: (path) =>
    `${path} is stored as an ObjectId: compare it with ObjectId('…')`,
  service: "Events come from GAS or CW: service: 'GAS'",
  box: "Events are in an outbox or an inbox: box: 'inbox'",
  tests: `A query has at most ${MAX_TESTS} conditions`,
  values: `A list has at most ${MAX_VALUES} values`,
  valueLength: (path) => `A value is at most ${maxLengthOf(path)} characters`,
  fields: "Paths to show are an object: { clientRef: 1, 'identifiers.sbi': 1 }",
  zero: "List the paths to show with 1. Leaving paths out isn’t needed: only those listed show",
  ownId: "_id is the record’s own id: name this column otherwise",
  collision: (shorter, longer) =>
    `Path collision at ${longer}: list ${shorter} or ${longer}`,
  dollarKey: (key, parent) =>
    `mongod can’t project a path holding ${key}: project its parent, '${parent}'`,
  show: "Show a path with 1, or work one out with $size, $sum, $min or $max: { parcels: { $size: '$phases.answers.parcels' } }",
  columns: `Show at most ${MAX_COLUMNS} columns`,
  name: `A name is at most ${MAX_NAME} characters`,
  dollarName: (key) => `A name can’t start with $: “${key}”`,
  emptyName:
    "A name goes here: { parcels: { $size: '$phases.answers.parcels' } }",
  sortOne: "Sort by one path: { createdAt: -1 }",
  sortWay: "Sort with 1 (lowest first) or -1 (highest first)",
  sortGroups: "Sort groups by _id or a name worked out in $group",
  limit: "limit takes a number: .limit(100)",
  limitMost: `Explore shows at most ${MAX_LIMIT.toLocaleString("en-GB")} rows`,
  stageLimit: "$limit takes a number: { $limit: 100 }",
  afterFind: (name) =>
    `.${name}(…) goes after find only: use $sort or $limit in aggregate`,
  ends: (method) => `${method} ends the query`,
  find: "find takes a filter and the paths to show: find({ … }, { clientRef: 1 })",
  aggregate:
    "aggregate takes a list of stages: [{ $match: { … } }, { $group: { … } }]",
  countDocuments: "countDocuments takes a filter: countDocuments({ … })",
  distinct:
    "distinct takes a path in quotes, then a filter: distinct('currentStatus', { … })",
  stage:
    "Each stage is one of $match, $unwind, $group, $sort, $limit or $project",
  stageNotAllowed: (key) =>
    `“${key}” isn’t allowed. Use $match, $unwind, $group, $sort, $limit or $project`,
  order:
    "Put the stages in this order: $match, $unwind, $group or $project, $sort, $limit",
  stages: `A pipeline has at most ${MAX_STAGES} stages`,
  unwind:
    "$unwind takes a path, as '$phases', or { path: '$phases', preserveNullAndEmptyArrays: true }",
  unwinds: `A pipeline unwinds at most ${MAX_UNWINDS} times`,
  unwindKey: (key) =>
    `“${key}” isn’t allowed here. $unwind takes path and preserveNullAndEmptyArrays`,
  preserve: "preserveNullAndEmptyArrays takes true or false",
  group: "$group takes { _id: '$path', name: { $sum: 1 } }",
  groupId: "$group needs _id: the path to group by, as '$currentStatus'",
  work: (name) => `Work out ${name} with $sum, $min, $max or $count`,
  sumOne: "$sum takes 1 to count, or a path as '$totalAmountPence'",
  count: "$count takes {}: { $count: {} }",
  cells: (columns, rows) =>
    `That’s too many cells to show: ${columns.toLocaleString("en-GB")} columns × ${rows.toLocaleString("en-GB")} rows. Show fewer columns or a lower limit.`,
};

export class ReadError extends Error {
  constructor(message, node) {
    super(message);
    this.at = node.at;
    this.end = node.end;
  }
}

export const fail = (message, node) => {
  throw new ReadError(message, node);
};

export const notAllowed = (key, message) =>
  key.startsWith("$") && !OPERATORS.has(key)
    ? OUTLINE_MESSAGES.operator(key)
    : message(key);

export const isNumber = (node, value) =>
  node.type === "number" && node.value === value;
const isLiteral = (node, value) =>
  node.type === "literal" && node.value === value;
export const isOne = (node) => isNumber(node, 1) || isLiteral(node, true);
export const isZero = (node) => isNumber(node, 0) || isLiteral(node, false);
export const isObject = (node) => node.type === "object";
export const onlyEntry = (node) =>
  isObject(node) && node.entries.length === 1 ? node.entries[0] : null;
