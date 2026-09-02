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

// eslint-disable-next-line complexity
export const paginate = async (collection, opts) => {
  const sort = ensureTieBreaker(opts.sort);
  const sortKeys = Object.keys(sort);
  const sortEntries = Object.entries(sort);
  const isBackward = opts.direction === "backward";
  const cursor = decodeCursor(opts.cursor, sortKeys, opts.codecs);

  const filter = cursor
    ? {
        ...opts.filter,
        ...getPagingFilter(cursor, sortEntries, isBackward),
      }
    : opts.filter;

  const effectiveSort = isBackward ? invert(sortEntries) : sort;

  const docs = await collection
    .find(filter)
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

  const isForward = !isBackward;
  const hasDocs = docs.length > 0;

  return {
    data: opts.mapDocument ? docs.map(opts.mapDocument) : docs,
    pagination: {
      startCursor: hasDocs
        ? encodeCursor(docs.at(0), sortKeys, opts.codecs)
        : null,

      endCursor: hasDocs
        ? encodeCursor(docs.at(-1), sortKeys, opts.codecs)
        : null,

      hasNextPage: isForward ? hasMore : true,
      hasPreviousPage: isForward ? !!cursor : hasMore,
    },
  };
};
