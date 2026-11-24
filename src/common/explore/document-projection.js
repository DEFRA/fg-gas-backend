import { isDollarSegment, parsePath } from "./paths.js";
import { refuseQuery } from "./refusal.js";

// Where the fetch keeps the document: every path of the projection is
// written under it, so mongod projects the record as it would on its own.
export const DOC = "d";

const EXPRESSIONS = { count: "$size", sum: "$sum", min: "$min", max: "$max" };

export const fieldOf = (path) => `$${DOC}.${path}`;

const under = (path) => `${DOC}.${path}`;

// A path as the Query names it is mongod's to project: well formed, and no
// key starting $, which mongod can't project.
export const projectable = (path) => {
  const names = parsePath(path);

  if (names === null || names.some(isDollarSegment)) {
    throw refuseQuery("PATH_NOT_ALLOWED");
  }

  return path;
};

// An `as` name, as mongod takes a computed field's name: a dotted name makes
// nested fields, and no part may be empty or start with $.
const checkedName = (name) => {
  if (name.split(".").some((part) => part === "" || part.startsWith("$"))) {
    throw refuseQuery("PATH_NOT_ALLOWED");
  }

  return name;
};

const fieldOfColumn = ({ fn, as, path }) => {
  const name = under(as === undefined ? path : checkedName(as));
  const field = fieldOf(projectable(path));

  if (fn) {
    return [name, { [EXPRESSIONS[fn]]: field }];
  }

  return [name, as === undefined ? 1 : field];
};

const ID = "_id";

const isId = (column) => column.path === ID && !column.fn && !column.as;

// The projection mongosh would send for the query, written on the fetch's
// document: each plain path `d.<path>: 1`, `_id` unless `_id: 0`, each
// renamed path `d.<as>: '$d.<path>'` and each expression `d.<as>: { $size:
// '$d.<path>' }` and so on. Built from the Query's checked columns, never
// from typed text, so mongod's own projection makes the document. A whole
// document has none, or only `d._id: 0`. `keep` names what the fetch keeps
// beside the document.
const wholeProjectionOf = ({ id }) => (id ? null : { [under(ID)]: 0 });

const idFieldsOf = ({ id }) => (id ? [[under(ID), 1]] : []);

// Where `_id: 0` leaves no column, mongod's projection makes an empty
// document.
const EMPTY = [[DOC, { $literal: {} }]];

export const documentProjectionOf = ({ columns, documents }, keep = []) => {
  if (documents.whole) {
    return wholeProjectionOf(documents);
  }

  const fields = [
    ...idFieldsOf(documents),
    ...columns.filter((column) => !isId(column)).map(fieldOfColumn),
  ];

  return Object.fromEntries([
    ...keep.map((name) => [name, 1]),
    ...(fields.length ? fields : EMPTY),
  ]);
};

// Every `$unwind` step on the fetch's document, each giving its element's
// index beside the document, never inside it, and each followed by
// `matchOf(n)`, which keeps only the rows asked for so far.
export const unwindStagesOf = (unwind, matchOf) =>
  unwind.flatMap(({ path, preserve }, n) => [
    {
      $unwind: {
        path: fieldOf(projectable(path)),
        includeArrayIndex: `i${n}`,
        preserveNullAndEmptyArrays: preserve,
      },
    },
    { $match: matchOf(n) },
  ]);

export const positionFieldsOf = (unwind) => unwind.map((_, n) => `$i${n}`);

export const positionKey = (n) => `i${n}`;
