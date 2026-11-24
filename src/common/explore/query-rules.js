import { isIdText } from "./bson-bytes.js";
import { pathsOfQuery } from "./fields.js";
import { hasDollarSegment, pathProblem } from "./paths.js";
import {
  DOCUMENTS_MODE,
  MAX_CELLS,
  MAX_DOCUMENT_BYTES,
} from "./query-schema.js";

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

// A `documents` fetch asks only for rows of the source's own boxes, each by
// a record's `_id` as the BSON of { _id }, at as many positions as the
// Query unwinds.
const isFetch = (query) => query.mode === DOCUMENTS_MODE;

const ownFetchRows = (source, query) => {
  const ids = boxIdsOf(source);

  return !isFetch(query) || query.rows.every((row) => ids.includes(row.box));
};

const idsAreIds = (_source, query) =>
  !isFetch(query) ||
  query.rows.every((row) => isIdText(row.id, MAX_DOCUMENT_BYTES));

const positionsFitUnwind = (_source, query) =>
  !isFetch(query) ||
  query.rows.every((row) => row.at.length === query.unwind.length);

// count(*) counts a group's records: a row is one record, so it has none.
const isStar = (ref) => ref?.path === "*";

const countsRecordsOnlyInGroups = (query) =>
  query.mode !== "rows" ||
  !(query.columns.some(isStar) || isStar(query.orderBy));

const isGroupPath = (query, column) =>
  Boolean(query.groupBy) && !column.fn && column.path === query.groupBy.path;

// mongod can't project a key starting $, so no column but the group's, and
// no unwind, names one: a filter, a sort and a group may.
export const projectedPathsOf = (query) => [
  ...query.columns.filter((column) => !isGroupPath(query, column)),
  ...(query.unwind ?? []),
];

const projectsNoDollarKey = (query) =>
  projectedPathsOf(query).every(({ path }) => !hasDollarSegment(path));

const RULES = [
  (_source, query) => fitsCells(query),
  (_source, query) => groupedRight(query),
  (_source, query) => countsRecordsOnlyInGroups(query),
  (_source, query) => projectsNoDollarKey(query),
  ownPositions,
  ownFetchRows,
  idsAreIds,
  positionsFitUnwind,
];

// Whether the Query a service is sent keeps every one of RULES, on this
// source.
export const keepsRules = (source, query) =>
  RULES.every((holds) => holds(source, query));

// How many of the paths a Query reads are malformed, each once: GAS's
// reader makes none, so only a forged Query has any.
export const refusedPathsOf = (query) =>
  [...new Set(pathsOfQuery(query))].filter((path) => pathProblem(path) !== null)
    .length;
