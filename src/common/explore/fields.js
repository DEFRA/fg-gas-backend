import { testsOf } from "./query-schema.js";

const POSITION = /^\d+$/;

// How a path is read from one box's records: walked from the record, or,
// for what the source adds to each record (an event's service and box),
// read from the box. `readable` says which paths below it may be read;
// `charge`, when given, is told the list elements each walk visits.
const readerOfPath =
  (source, { readable, charge }) =>
  (path) =>
    Object.hasOwn(source.added ?? {}, path)
      ? { path, read: source.added[path] }
      : { path, names: path.split("."), readable, charge };

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

const everyPath = () => true;

export const readersFor = (source, { readable = everyPath, charge } = {}) => {
  const reader = readerOfPath(source, { readable, charge });

  return { readerOf: ({ path }) => reader(path) };
};

export const usedReaders = (query, { readerOf }) =>
  pathsOfQuery(query).map((path) => readerOf({ path }));

// Mongo projects a list's position as a key, so a path is projected down to
// its first position.
const projectedOf = ({ names }) => {
  const at = names.findIndex((name) => POSITION.test(name));

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
