import { BSON } from "mongodb";

// Show it: one row of a run, read again by its record's `_id`. The run's
// query keeps its columns, sort, $unwind and limit; its filter is replaced
// by the record's `_id` (and, for an event, its service and box), so the
// read is of that record alone (an id read; on a small source, the full
// read it always is), and only the row at the run's unwind positions is
// kept. The run's row ranks no lower among its record's rows than among the
// run's, so the run's limit reaches it. The run's own filter is tested
// again on the record as fetched, so a record changed since says so rather
// than going missing.

// An `_id` whose text isn't valid UTF-8 is none the Query can name.
const idOf = (show) => {
  try {
    return {
      value: BSON.deserialize(Buffer.from(show.id, "base64"), {
        promoteValues: false,
      })._id,
    };
  } catch {
    return null;
  }
};

const isSafeLong = (value) =>
  value._bsontype === "Long" && Number.isSafeInteger(Number(value.toString()));

const isNumberType = (value) =>
  typeof value?._bsontype === "string" &&
  (["Int32", "Double"].includes(value._bsontype) || isSafeLong(value));

// The `_id` as the Query compares it, with the type a source declares for
// it; null for a type the Query can't name.
const ID_KINDS = [
  [
    "objectId",
    (value) => value?._bsontype === "ObjectId",
    (value) => ({ oid: value.toHexString() }),
  ],
  ["text", (value) => typeof value === "string", (value) => value],
  ["number", isNumberType, (value) => Number(value.toString())],
];

const kindOf = (id) =>
  id === null ? null : (ID_KINDS.find(([, holds]) => holds(id.value)) ?? null);

const isEvents = (source) => source.name === "events";

const hasBoxIff = (source, show) =>
  isEvents(source) === (show.service !== null && show.box !== null);

const declaredIdType = (source) => source.paths?.get("_id")?.type ?? null;

const isIdOfSource = (source, kind) => {
  const declared = declaredIdType(source);

  return kind !== null && (declared === null || declared === kind[0]);
};

const eq = (path, value) => ({ path, op: "eq", values: [value] });

const boxTestsOf = (source, show) =>
  isEvents(source) ? [eq("service", show.service), eq("box", show.box)] : [];

// The row's positions: one for each $unwind, none where it kept no element
// or the record's value there was no list. Which of those the record holds
// is known once it is read: a list's rows are all at an element.
const fitsUnwind = ({ query }, show) => show.at.length === query.unwind.length;

const NOT_ITS_ROW = "Show it’s row positions don’t fit this query’s $unwind";

const NO_RECORDS =
  "Show it shows one record’s row, and this query gives no records";

const BOX_ONLY_FOR_EVENTS =
  "Show it reads an event by its service and box, and nothing else by them";

const notAnIdOf = (source) => `This _id isn’t one ${source.noun.many} have`;

// Why the run's row can't be read again, if it can't: the first rule it
// breaks.
const RULES = [
  [({ checked }) => checked.query.mode === "rows", () => NO_RECORDS],
  [
    ({ checked, kind }) => isIdOfSource(checked.source, kind),
    ({ checked }) => notAnIdOf(checked.source),
  ],
  [({ checked, show }) => fitsUnwind(checked, show), () => NOT_ITS_ROW],
  [
    ({ checked, show }) => hasBoxIff(checked.source, show),
    () => BOX_ONLY_FOR_EVENTS,
  ],
];

const whyNot = (checked, show, kind) => {
  const broken = RULES.find(([holds]) => !holds({ checked, show, kind }));

  return broken ? broken[1]({ checked }) : null;
};

// The Query that reads the run's row again, or why it can't be read.
export const showQueryOf = (checked, show) => {
  const id = idOf(show);
  const kind = kindOf(id);
  const error = whyNot(checked, show, kind);

  if (error) {
    return { error };
  }

  return {
    query: {
      ...checked.query,
      where: {
        all: [
          eq("_id", kind[2](id.value)),
          ...boxTestsOf(checked.source, show),
        ],
      },
    },
  };
};

const isAt = (at) => (row) =>
  row.fetch.at.length === at.length &&
  row.fetch.at.every((n, m) => n === at[m]);

// The run's row alone, out of the record's rows: the one at its positions.
// None when the record, or that element of it, is gone.
// `cut`: the read kept fewer of the record's rows than it found, so a row
// not among them isn't known to be gone.
export const shownOnly = (answer, show) => {
  const rows = answer.rows.filter(isAt(show.at));

  return {
    ...answer,
    rows,
    count: answer.count && { n: rows.length, capped: false },
    cut: !answer.count || answer.count.n > answer.rows.length,
  };
};

const isWhole = (answer) => answer.read !== "windowed" && !answer.cut;

const isRowGone = (answer) =>
  answer.rows.length === 0 || answer.rows[0].docNote?.gone === true;

// Whether the record shown is gone: a read of all its rows found none at
// its positions, or its document was gone when fetched.
export const isShownGone = (answer) => isWhole(answer) && isRowGone(answer);
