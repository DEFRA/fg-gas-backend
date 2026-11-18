import { pathsOfQuery } from "./fields.js";
import { pathProblem } from "./paths.js";
import { MAX_CELLS } from "./query-schema.js";

// The rules GAS's checker applies to a query, checked again on the Query a
// service is sent, so a forged one is refused as GAS would refuse it.
const fitsCells = (query) => query.columns.length * query.limit <= MAX_CELLS;

// Groups show the group's path, then what is worked out of each group.
const GROUPED_COLUMNS = {
  groups: (query) =>
    query.columns.every(
      (column) => column.fn || column.path === query.groupBy.path,
    ),
  distinct: (query) =>
    query.columns.length === 1 &&
    query.columns[0].path === query.groupBy.path &&
    !query.columns[0].fn,
};

const groupedRight = (query) =>
  Object.hasOwn(GROUPED_COLUMNS, query.mode)
    ? GROUPED_COLUMNS[query.mode](query)
    : true;

const boxIdsOf = (source) =>
  source.boxes
    ? source.boxes.map(({ id }) => id)
    : [`${source.service.toLowerCase()}.${source.name}`];

const ownPositions = (source, query) => {
  const ids = boxIdsOf(source);

  return Object.keys(query.positions ?? {}).every((id) => ids.includes(id));
};

// count(*) counts a group's records: a row is one record, so it has none.
const isStar = (ref) => ref?.path === "*";

const countsRecordsOnlyInGroups = (query) =>
  query.mode !== "rows" ||
  !(query.columns.some(isStar) || isStar(query.orderBy));

const RULES = [
  (_source, query) => fitsCells(query),
  (_source, query) => groupedRight(query),
  (_source, query) => countsRecordsOnlyInGroups(query),
  ownPositions,
];

// Whether a Query keeps every rule GAS's checker applies, on this source.
export const keepsRules = (source, query) =>
  RULES.every((holds) => holds(source, query));

// How many of the paths a Query reads the source may not, each once: off
// its roots, denied, or below its answers and off their list.
export const refusedPathsOf = (query, lists) =>
  [...new Set(pathsOfQuery(query))].filter(
    (path) => pathProblem(path, lists) !== null,
  ).length;
