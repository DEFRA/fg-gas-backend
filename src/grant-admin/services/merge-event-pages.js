import {
  SOURCE_KEYS,
  encodeCompositeCursor,
  encodeSourceCursor,
} from "./event-cursor.js";

export const PAGE_SIZE = 20;

// Matches the ticket's `(createdAt desc, service, box, _id desc)` and each
// source's own `{ sortKey: -1, _id: -1 }`.
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

export const compareAsc = (a, b) => -compareDesc(a, b);

const isForwardDirection = (direction) => direction !== "backward";

// Backward asks each source for the rows immediately *newer* than its cursor,
// so the merged page takes the oldest 20 of those candidates (the ones closest
// to the cursor) and reverses them back to DESC for the response.
export const mergePages = ({ pages, direction }) => {
  const isForward = isForwardDirection(direction);
  const comparator = isForward ? compareDesc : compareAsc;

  const taken = pages
    .flatMap((page) => page.tuples)
    .sort(comparator)
    .slice(0, PAGE_SIZE);

  const ordered = isForward ? taken : [...taken].reverse();

  return { taken, events: ordered.map((tuple) => tuple.row) };
};

const groupByKey = (taken) => {
  const grouped = {};

  for (const tuple of taken) {
    grouped[tuple.key] ??= [];
    grouped[tuple.key].push(tuple);
  }

  return grouped;
};

// `taken` is DESC for forward and ASC for backward, so newest/oldest is
// first/last for forward and last/first for backward.
const boundaries = (tuples, isForward) => ({
  newest: isForward ? tuples[0] : tuples.at(-1),
  oldest: isForward ? tuples.at(-1) : tuples[0],
});

// A source page's own rows are DESC whichever way we travelled - `paginate`
// re-reverses a backward read before returning it - so the candidate nearest
// the incoming cursor is the FIRST row going forward and the LAST going
// backward.
const nearestCandidate = (page, isForward) =>
  isForward ? page.tuples[0] : page.tuples.at(-1);

// What a source that contributed NO rows to this page answers with. The two
// cursors need different answers, and giving them the same one is the bug
// behind "Newer, then Older, does not come back to the same rows".
//
// The direction we travelled is the easy half: nothing of this source was
// consumed, so the next page the same way has to resume exactly where this one
// started - the incoming slice, unchanged.
//
// The OPPOSITE direction is the half that was wrong. The incoming slice is
// this source's boundary row on the page we came FROM, and that row has to
// come back when the operator turns round. Keyset reads are strictly
// exclusive, so reading from the incoming slice skips precisely that row.
// What we want is the candidate this source *did* return nearest its cursor:
// reading from that one is exclusive of it and therefore lands back on the
// boundary row, which is the first thing the page we came from showed.
//
// A source that answered with nothing at all has no such candidate - its
// stream ends at the incoming slice - so the far end is the honest position.
// `null` reads from the newest going older and from the oldest going newer,
// and in both cases the boundary row is the first one it reaches.
const unconsumedSlice = ({ key, isForward, incoming, page }) => {
  // No page at all: the source was not selected, or its read failed. We know
  // nothing about where it sits, so both cursors keep what they came with -
  // resetting one would restart the source from the far end of its stream.
  if (!page) {
    return { start: incoming, end: incoming };
  }

  const nearest = nearestCandidate(page, isForward);
  const opposite = nearest ? encodeSourceCursor(key, nearest) : null;

  return isForward
    ? { start: opposite, end: incoming }
    : { start: incoming, end: opposite };
};

const sliceFor = ({ key, tuples, isForward, incoming, page }) => {
  if (tuples.length === 0) {
    return unconsumedSlice({ key, isForward, incoming, page });
  }

  const { newest, oldest } = boundaries(tuples, isForward);

  return {
    start: encodeSourceCursor(key, newest),
    end: encodeSourceCursor(key, oldest),
  };
};

const byKey = (pages) =>
  Object.fromEntries(pages.map((page) => [page.key, page]));

const buildSlices = ({ slices, takenByKey, pages, isForward }) => {
  const start = {};
  const end = {};
  const pageByKey = byKey(pages);

  for (const key of SOURCE_KEYS) {
    const slice = sliceFor({
      key,
      tuples: takenByKey[key] ?? [],
      isForward,
      incoming: slices[key],
      page: pageByKey[key],
    });

    start[key] = slice.start;
    end[key] = slice.end;
  }

  return { start, end };
};

// "More where that came from": rows this source returned but we did not take,
// or the source's own look-ahead in this direction.
const hasRemaining = (page, takenCount, isForward) =>
  page.tuples.length > takenCount ||
  (isForward ? page.pagination.hasNextPage : page.pagination.hasPreviousPage);

const anyRemaining = (pages, takenByKey, isForward) =>
  pages.some((page) =>
    hasRemaining(page, takenByKey[page.key]?.length ?? 0, isForward),
  );

const toCursors = (hasRows, start, end) => ({
  startCursor: hasRows ? encodeCompositeCursor(start) : null,
  endCursor: hasRows ? encodeCompositeCursor(end) : null,
});

export const buildPagination = ({
  slices,
  pages,
  taken,
  direction,
  hadCursor,
}) => {
  const isForward = isForwardDirection(direction);
  const takenByKey = groupByKey(taken);
  const { start, end } = buildSlices({ slices, takenByKey, pages, isForward });
  const remaining = anyRemaining(pages, takenByKey, isForward);

  return {
    ...toCursors(taken.length > 0, start, end),
    // forward hasPreviousPage mirrors `paginate`'s `!!cursor`; backward
    // hasNextPage mirrors its unconditional `true`.
    hasNextPage: isForward ? remaining : true,
    hasPreviousPage: isForward ? hadCursor : remaining,
  };
};
