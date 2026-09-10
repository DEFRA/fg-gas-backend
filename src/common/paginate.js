import Boom from "@hapi/boom";

const encodeCursor = (doc, sortKeys, codecs) => {
  const data = Object.fromEntries(
    sortKeys.map((key) => [key, codecs[key].encode(doc[key])]),
  );
  return Buffer.from(JSON.stringify(data)).toString("base64url");
};

const decodeCursor = (cursor, sortKeys, codecs) => {
  if (!cursor) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(cursor, "base64url").toString());
    return Object.fromEntries(
      sortKeys.map((key) => [key, codecs[key].decode(data[key])]),
    );
  } catch {
    throw Boom.badRequest("Cannot decode cursor");
  }
};

const getPagingFilter = (cursor, sortEntries, isBackward) => {
  const op = (dir) => ((dir === 1) !== isBackward ? "$gt" : "$lt");

  return {
    $or: sortEntries.map((_, i) => ({
      ...Object.fromEntries(
        sortEntries.slice(0, i).map(([k]) => [k, cursor[k]]),
      ),
      [sortEntries[i][0]]: {
        [op(sortEntries[i][1])]: cursor[sortEntries[i][0]],
      },
    })),
  };
};

const invert = (sortEntries) =>
  Object.fromEntries(sortEntries.map(([k, v]) => [k, -v]));

const ensureTieBreaker = (sort) => {
  if (sort._id) {
    return sort;
  }

  return {
    ...sort,
    _id: Object.values(sort).at(-1),
  };
};

// `docs.at()` is undefined on an empty page, and an empty page has no cursors.
const edgeCursor = (doc, sortKeys, codecs) =>
  doc === undefined ? null : encodeCursor(doc, sortKeys, codecs);

const buildPageInfo = ({
  docs,
  hasMore,
  isBackward,
  cursor,
  sortKeys,
  codecs,
}) => ({
  startCursor: edgeCursor(docs.at(0), sortKeys, codecs),
  endCursor: edgeCursor(docs.at(-1), sortKeys, codecs),
  hasNextPage: isBackward ? true : hasMore,
  hasPreviousPage: isBackward ? hasMore : Boolean(cursor),
});

// The page's position, composed with its filter under `$and` and never merged
// by spread: the keyset clause is an `$or` over the sort keys and so is a
// search filter, so spreading one over the other silently drops whichever came
// first - a paged search loses its filter after page 1. `$and` cannot collide
// however either side is shaped, and Mongo flattens it for the query plan, so
// it costs nothing.
const withKeyset = (filter, cursor, sortEntries, isBackward) => {
  if (!cursor) {
    return filter;
  }

  return {
    $and: [filter ?? {}, getPagingFilter(cursor, sortEntries, isBackward)],
  };
};

// A ceiling where the caller sets one. The admin list can be a collection scan
// on a box big enough - a `q` search always is - and one page turn holding a
// connection for as long as Mongo will work is worse than the page saying that
// source could not be read.
const findOptions = (opts) =>
  opts.maxTimeMS ? { maxTimeMS: opts.maxTimeMS } : {};

export const paginate = async (collection, opts) => {
  const sort = ensureTieBreaker(opts.sort);
  const sortKeys = Object.keys(sort);
  const sortEntries = Object.entries(sort);
  const isBackward = opts.direction === "backward";
  const cursor = decodeCursor(opts.cursor, sortKeys, opts.codecs);

  const filter = withKeyset(opts.filter, cursor, sortEntries, isBackward);
  const effectiveSort = isBackward ? invert(sortEntries) : sort;

  const docs = await collection
    .find(filter, findOptions(opts))
    .project(opts.project)
    .sort(effectiveSort)
    .limit(opts.pageSize + 1)
    .toArray();

  const hasMore = docs.length > opts.pageSize;

  if (hasMore) {
    docs.pop();
  }

  if (isBackward) {
    docs.reverse();
  }

  return {
    data: docs,
    pagination: buildPageInfo({
      docs,
      hasMore,
      isBackward,
      cursor,
      sortKeys,
      codecs: opts.codecs,
    }),
  };
};
