import { encodeCursor } from "../../../common/buckets/cursor.js";
import { PAGE_SIZE } from "../../../common/buckets/schema.js";
import { parseCursorText } from "./cursor.js";

// A box that answers as the bucket engine does, over rows held in memory:
// exact, `limit + 1` rows after the cursor; bounded, an edge `budget`
// candidates older than the cursor's time, and the matches down to it.

const compare = (a, b) => {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
};

const newestFirst = (a, b) => compare(b.t, a.t) || compare(b.i, a.i);

const isAfter = (at) => (row) =>
  at === null || row.t < at.t || (row.t === at.t && row.i < at.i);

const isWithin = (edge) => (row) =>
  edge === null || row.t > edge.t || (row.t === edge.t && row.i >= edge.i);

const isCandidate = (row) => row.candidate !== false;

const isMatch = (row) => isCandidate(row) && row.match !== false;

const edgeOf = (sorted, at, { kind, budget }) =>
  kind === "bounded"
    ? (sorted.filter(
        (row) => isCandidate(row) && (at === null || row.t < at.t),
      )[budget - 1] ?? null)
    : null;

const toRow = ({ t, i }) => ({
  id: i,
  time: t,
  title: "Event",
  subtitle: null,
  cells: { status: "COMPLETED" },
  link: null,
});

const pageOf = (docs, edge) => {
  if (docs.length > PAGE_SIZE) {
    const last = docs[PAGE_SIZE - 1];

    return {
      next: encodeCursor(last),
      keepLooking: null,
      searchedTo: null,
      complete: false,
    };
  }

  return edge
    ? {
        next: null,
        keepLooking: encodeCursor(edge),
        searchedTo: edge.t,
        complete: false,
      }
    : { next: null, keepLooking: null, searchedTo: null, complete: true };
};

const totalOf = (rows, plan) => {
  const n = rows.filter(isMatch).length;

  return plan.kind === "exact"
    ? { count: Math.min(n, 10_000), capped: n > 10_000 }
    : null;
};

const EXACT = { kind: "exact" };

export const aFakeBox =
  (bucket, rows, plan = EXACT) =>
  ({ cursor, count }) => {
    const at = cursor === undefined ? null : parseCursorText(cursor);
    const sorted = [...rows].sort(newestFirst);
    const edge = edgeOf(sorted, at, plan);
    const docs = sorted
      .filter(isMatch)
      .filter(isAfter(at))
      .filter(isWithin(edge))
      .slice(0, PAGE_SIZE + 1);

    return {
      bucket,
      plan: {
        kind: plan.kind,
        index: [],
        bound: ["status"],
        filled: [],
        residual: plan.kind === "bounded" ? ["lastError.name"] : [],
        scans: 1,
      },
      rows: docs.slice(0, PAGE_SIZE).map(toRow),
      page: pageOf(docs, edge),
      groups: [],
      ...(count && { total: totalOf(rows, plan) }),
    };
  };

const byKey = (a, b) =>
  compare(b.t, a.t) || compare(a.box, b.box) || compare(b.i, a.i);

// Every matching row of every box, newest first as the group orders them.
export const referenceOf = (boxes) =>
  Object.entries(boxes)
    .flatMap(([bucket, rows]) =>
      rows.filter(isMatch).map(({ t, i }) => ({ t, i, box: bucket })),
    )
    .sort(byKey);

const keyOf = ({ box, i }) => `${box}\n${i}`;

const pageProblems = (page, n) => {
  const problems = [];

  if (page.rows.length > PAGE_SIZE) {
    problems.push(`page ${n} has ${page.rows.length} rows`);
  }

  if (page.page.next !== null && page.rows.length !== PAGE_SIZE) {
    problems.push(`page ${n} is short with more to read`);
  }

  return problems;
};

const shownTo = (shown, reference, searchedTo) =>
  reference
    .filter(({ t }) => t > searchedTo)
    .every((row) => shown.has(keyOf(row)));

// What is wrong with a walk: rows repeated, missing or out of order, a page
// too long, or short with more to read, or a search that skipped rows newer
// than it says it has searched to.
export const walkProblems = (pages, reference, toBox) => {
  const got = pages.flatMap(({ rows }) =>
    rows.map((row) => ({ box: toBox(row.cells.box), i: row.id, t: row.time })),
  );
  const problems = pages.flatMap(pageProblems);
  const shown = new Set();

  pages.forEach((page, n) => {
    page.rows.forEach((row) =>
      shown.add(keyOf({ box: toBox(row.cells.box), i: row.id })),
    );

    if (
      page.page.keepLooking !== null &&
      !shownTo(shown, reference, page.page.searchedTo)
    ) {
      problems.push(
        `page ${n} skipped rows newer than ${page.page.searchedTo}`,
      );
    }
  });

  if (got.map(keyOf).join() !== reference.map(keyOf).join()) {
    problems.push(
      `walk of ${got.length} rows is not the ${reference.length} of the reference`,
    );
  }

  return problems;
};

const wayOn = ({ page }) => page.next ?? page.keepLooking;

const MAX_PAGES = 2_000;

const readOn = async (reader, pages) => {
  if (wayOn(pages.at(-1)) === null) {
    return pages;
  }

  if (pages.length >= MAX_PAGES) {
    throw new Error("The walk never ended");
  }

  return readOn(reader, [...pages, await reader.later(wayOn(pages.at(-1)))]);
};

// Each page read from the last's way on, as Load more and Keep looking do.
export const walkOf = async (reader) =>
  readOn(reader, [await reader.first(true)]);
