import {
  SOURCE_KEYS,
  encodeCompositeCursor,
  encodeSourceCursor,
} from "./event-cursor.js";

export const PAGE_SIZE = 20;

const SERVICE_RANK = { gas: 0, caseworking: 1 };
const BOX_RANK = { inbox: 0, outbox: 1 };

// null orders last in DESC, exactly as BSON null does
const orderValue = (tuple) => tuple.order ?? -Infinity;

const compareOrder = (a, b) => orderValue(b) - orderValue(a);

const compareService = (a, b) =>
  SERVICE_RANK[a.row.service] - SERVICE_RANK[b.row.service];

const compareBox = (a, b) => BOX_RANK[a.row.box] - BOX_RANK[b.row.box];

const compareIdDesc = (a, b) => {
  if (a.id === b.id) {
    return 0;
  }

  return a.id < b.id ? 1 : -1;
};

export const compareDesc = (a, b) =>
  compareOrder(a, b) ||
  compareService(a, b) ||
  compareBox(a, b) ||
  compareIdDesc(a, b);

export const mergePages = ({ pages }) => {
  const taken = pages
    .flatMap((page) => page.tuples)
    .sort(compareDesc)
    .slice(0, PAGE_SIZE);

  return {
    taken,
    events: taken.map((tuple) => tuple.row),
  };
};

const groupByKey = (taken) => {
  const grouped = {};

  for (const tuple of taken) {
    grouped[tuple.key] ??= [];
    grouped[tuple.key].push(tuple);
  }

  return grouped;
};

// A source that contributed nothing keeps its position: it has not moved.
const sliceFor = ({ tuples, incoming }) =>
  tuples.length === 0 ? incoming : encodeSourceCursor(tuples.at(-1));

const buildSlices = ({ slices, takenByKey }) =>
  Object.fromEntries(
    SOURCE_KEYS.map((key) => [
      key,
      sliceFor({ tuples: takenByKey[key] ?? [], incoming: slices[key] }),
    ]),
  );

const hasRemaining = (page, takenCount) =>
  page.tuples.length > takenCount || page.pagination.hasNextPage;

const anyRemaining = (pages, takenByKey) =>
  pages.some((page) => hasRemaining(page, takenByKey[page.key]?.length ?? 0));

export const buildPagination = ({ slices, pages, taken }) => {
  const takenByKey = groupByKey(taken);

  return {
    endCursor:
      taken.length > 0
        ? encodeCompositeCursor(buildSlices({ slices, takenByKey }))
        : null,
    hasNextPage: anyRemaining(pages, takenByKey),
  };
};
