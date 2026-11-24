import { isDollarSegment } from "./paths.js";
import { testsOf } from "./query-schema.js";

const POSITION = /^\d+$/;

// How a path is read from one box's records: walked from the record, or,
// for what the source adds to each record (an event's service and box),
// read from the box. `charge`, when given, is told the list elements each
// walk visits.
const readerOfPath =
  (source, { charge }) =>
  (path) =>
    Object.hasOwn(source.added ?? {}, path)
      ? { path, read: source.added[path] }
      : { path, names: path.split("."), charge };

const isStar = (ref) => ref?.path === "*";

// Every path a Query reads: in its filter, its unwinds, its columns, its
// group and its sort.
export const pathsOfQuery = (query) =>
  [
    ...testsOf(query.where),
    ...(query.unwind ?? []),
    ...query.columns,
    query.groupBy,
    query.orderBy,
  ]
    .filter((ref) => ref && !isStar(ref))
    .map(({ path }) => path);

export const readersFor = (source, { charge } = {}) => {
  const reader = readerOfPath(source, { charge });

  return { readerOf: ({ path }) => reader(path) };
};

export const usedReaders = (query, { readerOf }) =>
  pathsOfQuery(query).map((path) => readerOf({ path }));

// Mongo projects a list's position as a key, and refuses a key starting $,
// so a path is projected down to its first position or $ key. A record is
// no list, so its own keys are kept whatever they are.
const isCut = (name, at) =>
  at > 0 && (POSITION.test(name) || isDollarSegment(name));

const projectedOf = ({ names }) => {
  const at = names.findIndex(isCut);

  return (at === -1 ? names : names.slice(0, at)).join(".");
};

const pathsOfReader = (reader) => (reader.names ? [projectedOf(reader)] : []);

const isCovered = (paths) => (path) =>
  paths.some((other) => other !== path && path.startsWith(`${other}.`));

// Only what is read, and no path below another, which Mongo refuses.
export const projectionOf = (paths) => {
  const unique = [...new Set(paths.filter(Boolean))];

  return Object.fromEntries(
    unique.filter((path) => !isCovered(unique)(path)).map((path) => [path, 1]),
  );
};

export const readPathsOf = (readers) => readers.flatMap(pathsOfReader);

// Where a scanned record carries its stored BSON size: a name no typed path
// can be, so no query reads it as a field.
export const SIZE_KEY = "explore size";

// A scan's projection, with each record's size when its document may be
// fetched: one number, worked out by mongod.
export const sizedProjectionOf = (paths, sized) => ({
  ...projectionOf(paths),
  ...(sized && { [SIZE_KEY]: { $bsonSize: "$$ROOT" } }),
});
