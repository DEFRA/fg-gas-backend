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

const getPagingFilter = (cursor, sortEntries) => {
  const op = (dir) => (dir === 1 ? "$gt" : "$lt");

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

const ensureTieBreaker = (sort) => {
  if (sort._id) {
    return sort;
  }

  return {
    ...sort,
    _id: Object.values(sort).at(-1),
  };
};

const edgeCursor = (doc, sortKeys, codecs) =>
  doc === undefined ? null : encodeCursor(doc, sortKeys, codecs);

// Implied by the `$or`, but it gives the planner a bound on the leading index key.
const leadingBound = (cursor, [key, dir]) => ({
  [key]: { [dir === 1 ? "$gte" : "$lte"]: cursor[key] },
});

// Under `$and`, never spread: keyset and search are both `$or`s and one would be lost.
const withKeyset = (filter, cursor, sortEntries) => {
  if (!cursor) {
    return filter;
  }

  return {
    $and: [
      filter ?? {},
      leadingBound(cursor, sortEntries[0]),
      getPagingFilter(cursor, sortEntries),
    ],
  };
};

// Bounds a read that can be a collection scan, e.g. a `q` search.
const findOptions = (opts) =>
  opts.maxTimeMS ? { maxTimeMS: opts.maxTimeMS } : {};

export const paginate = async (collection, opts) => {
  const sort = ensureTieBreaker(opts.sort);
  const sortKeys = Object.keys(sort);
  const sortEntries = Object.entries(sort);
  const cursor = decodeCursor(opts.cursor, sortKeys, opts.codecs);

  const filter = withKeyset(opts.filter, cursor, sortEntries);

  const docs = await collection
    .find(filter, findOptions(opts))
    .project(opts.project)
    .sort(sort)
    .limit(opts.pageSize + 1)
    .toArray();

  const hasMore = docs.length > opts.pageSize;

  if (hasMore) {
    docs.pop();
  }

  return {
    data: docs,
    pagination: {
      endCursor: edgeCursor(docs.at(-1), sortKeys, opts.codecs),
      hasNextPage: hasMore,
    },
  };
};
