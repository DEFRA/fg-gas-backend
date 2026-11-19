// What a query may say, as tables: nothing outside them is ever read.
// Maps, so no name an object inherits is ever one of them.

export const SOURCES = [
  "applications",
  "cases",
  "grants",
  "workflows",
  "events",
  "agreements",
  "payments",
];

export const METHODS = new Map([
  ["find", { args: 2, chains: true }],
  ["aggregate", { args: 1, chains: false }],
  ["countDocuments", { args: 1, chains: false }],
  ["distinct", { args: 2, chains: false }],
]);

export const CHAINED = new Set(["sort", "limit"]);

// A filter's operators on one path, onto the Query's.
export const FILTER_OPS = new Map([
  ["$eq", "eq"],
  ["$ne", "ne"],
  ["$gt", "gt"],
  ["$gte", "gte"],
  ["$lt", "lt"],
  ["$lte", "lte"],
  ["$in", "in"],
  ["$nin", "nin"],
  ["$exists", "exists"],
  ["$regex", "regex"],
  ["$options", "options"],
  ["$not", "not"],
]);

export const LOGIC = new Map([
  ["$and", "all"],
  ["$or", "any"],
  ["$nor", "nor"],
]);

// The stages, each with its place: in this order, one of each but $unwind,
// which may follow itself.
export const STAGES = new Map(
  [
    ["$match"],
    ["$unwind"],
    ["$group", "$project"],
    ["$sort"],
    ["$limit"],
  ].flatMap((stages, place) => stages.map((stage) => [stage, place])),
);

export const REPEATED_STAGES = new Set(["$unwind"]);

export const MAX_STAGES = 5;

export const ACCUMULATORS = new Map([
  ["$sum", "sum"],
  ["$min", "min"],
  ["$max", "max"],
  ["$count", "count"],
]);

export const EXPRESSIONS = new Map([
  ["$size", "count"],
  ["$sum", "sum"],
  ["$min", "min"],
  ["$max", "max"],
]);

export const VALUE_CALLS = new Set(["ISODate", "Date"]);
export const LITERALS = new Map([
  ["true", true],
  ["false", false],
  ["null", null],
]);

// Every $word a query may hold, wherever it goes.
export const OPERATORS = new Set([
  ...FILTER_OPS.keys(),
  ...LOGIC.keys(),
  ...STAGES.keys(),
  ...ACCUMULATORS.keys(),
  ...EXPRESSIONS.keys(),
]);

export const MAX_TOKENS = 1000;
export const MAX_NESTING = 8;
