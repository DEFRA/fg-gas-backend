import { PREFIX } from "../search/declaration.js";
import { searchKeyOf } from "../search/document.js";
import { findSearchSource } from "../search/source.js";
import { countSearchMatches, readSearchPage } from "../search/store.js";
import { EXACT } from "./plan.js";
import {
  COUNT_CAP,
  MAX_TIME_MS_EXPIRED,
  cappedAt,
  collectionOf,
  endOfPage,
  pageAfter,
  rangeOf,
  refuseTimedOut,
  timeLeft,
  toRow,
  withoutValues,
} from "./read.js";
import { refuse } from "./refusal.js";

const MIN_PREFIX_LENGTH = 3;

export const declaredField = async (bucket, { where, field }) => {
  const { collection, lead } = bucket.search;
  const { fields } = await findSearchSource(collection).declarations.forValue(
    where[lead],
  );
  const declared = fields.find(({ key }) => key === field.key);

  if (!declared) {
    throw refuse("UNKNOWN_FIELD");
  }

  if (declared.match === PREFIX && field.value.length < MIN_PREFIX_LENGTH) {
    throw refuse("FIELD_TOO_SHORT");
  }

  return { ...field, match: declared.match };
};

const searchMatchOf = (read) => ({
  value: read.query.where[read.bucket.search.lead],
  field: read.query.field,
  range: rangeOf(read),
});

const inOrderOf = (hits, docs) => {
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));

  return hits.map(({ _id }) => byId.get(String(_id))).filter(Boolean);
};

// Ids from the search table, newest first, then their records by _id.
const readFieldPage = async (read) => {
  const { bucket, query } = read;
  const hits = await readSearchPage(bucket.search, {
    ...searchMatchOf(read),
    after: query.cursor,
    limit: query.limit + 1,
    maxTimeMS: timeLeft(read),
  }).catch(refuseTimedOut);
  const kept = hits.slice(0, query.limit);
  const docs = await collectionOf(read)
    .find(
      { _id: { $in: kept.map(({ _id }) => _id) } },
      {
        projection: { ...bucket.row.projection, [bucket.time.field]: 1 },
        maxTimeMS: timeLeft(read),
      },
    )
    .toArray()
    .catch(refuseTimedOut);

  return {
    rows: inOrderOf(kept, docs).map(toRow(bucket)),
    page:
      hits.length > query.limit
        ? pageAfter(bucket, kept.at(-1))
        : { ...endOfPage, complete: true },
  };
};

// Counted on the first page only, as groups are. A count out of time is no
// reason to fail the rows beside it.
const readFieldTotal = async (read) => {
  if (read.query.cursor) {
    return null;
  }

  try {
    const found = await countSearchMatches(read.bucket.search, {
      ...searchMatchOf(read),
      limit: COUNT_CAP + 1,
      maxTimeMS: timeLeft(read),
    });

    return cappedAt(found, COUNT_CAP);
  } catch (error) {
    if (error.code === MAX_TIME_MS_EXPIRED) {
      return null;
    }

    throw withoutValues(error);
  }
};

// A field search counts its matches as a whole, in `total`.
const uncounted = (fact) => ({ by: fact, values: null, total: null });

export const readFieldSearch = async (read) => {
  const [{ rows, page }, total] = await Promise.all([
    readFieldPage(read),
    readFieldTotal(read),
  ]);

  return { rows, page, groups: read.query.groupBy.map(uncounted), total };
};

export const describeFieldPlan = ({ bucket }) => ({
  kind: EXACT,
  index: Object.keys(searchKeyOf(bucket.search.lead)),
  bound: [bucket.search.lead, "field"],
  filled: [],
  residual: [],
  scans: 1,
});
