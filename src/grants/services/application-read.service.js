import {
  countApplicationRows,
  findApplicationIdentifiers,
  findApplicationRowsByClientRefs,
  findApplicationRowsInSeries,
  findApplicationRowsPage,
  findApplicationSummaryRow,
  findStoredApplicationDocument,
} from "../repositories/application.repository.js";
import { findSeriesByClientRefs } from "../repositories/application-series.repository.js";
import { findCodes } from "../repositories/grant.repository.js";

const TOTAL_CAP = 10_000;
// A series is a handful of records; this only bounds a pathological one.
const SEARCH_CAP = 200;

// Matched on the row's own code: a ref reused under another grant is a
// different application.
const isReplaced = (series, { clientRef, code }) =>
  series.some((s) => s.code === code && s.isReplaced(clientRef));

const withReplaced = async (rows) => {
  const series = rows.length
    ? await findSeriesByClientRefs([...new Set(rows.map((r) => r.clientRef))])
    : [];

  return rows.map((row) => ({ ...row, replaced: isReplaced(series, row) }));
};

/** One keyset page of applications, newest first. */
export const browseApplications = async ({
  code,
  from,
  to,
  cursor,
  pageSize,
}) => {
  const page = await findApplicationRowsPage({
    code,
    from,
    to,
    cursor,
    pageSize,
  });

  return { rows: await withReplaced(page.rows), pagination: page.pagination };
};

/** Every application in each series the ref is in, newest first, in one bounded read. */
export const findApplicationsInSeriesOf = async ({ ref, code, from, to }) => {
  const series = await findSeriesByClientRefs([ref], code);
  const found = await findApplicationRowsInSeries({
    ref,
    series,
    code,
    from,
    to,
    limit: SEARCH_CAP + 1,
  });
  const rows = found.slice(0, SEARCH_CAP);

  return {
    rows: await withReplaced(rows),
    total: { count: rows.length, capped: found.length > SEARCH_CAP },
  };
};

export const countApplications = async ({ code, from, to }) => {
  const count = await countApplicationRows(
    { code, from, to },
    { limit: TOTAL_CAP + 1 },
  );

  return { count: Math.min(count, TOTAL_CAP), capped: count > TOTAL_CAP };
};

// The application's facts and stored size, or null when there is none.
export const findApplicationSummary = ({ clientRef, code }) =>
  findApplicationSummaryRow({ clientRef, code });

/**
 * The stored document exactly as stored, and its size; a document over
 * `maxBytes` is answered by its size alone, with a null document. Null when
 * there is no such application.
 */
export const findApplicationDocument = ({ clientRef, code }, { maxBytes }) =>
  findStoredApplicationDocument({ clientRef, code }, { maxBytes });

const toMember = ({ clientRef, position, createdAt }) => ({
  clientRef,
  position,
  createdAt: createdAt ?? null,
});

// A ref the series names but no application holds keeps its slot, with no facts.
const noApplication = (clientRef) => ({
  clientRef,
  position: { phase: null, stage: null, status: null },
  createdAt: null,
});

// Oldest first, the order the series added them. A series of one has no
// other member to show.
const membersOf = async (series) => {
  const refs = [...series.clientRefs];

  if (refs.length < 2) {
    return [];
  }

  const rows = await findApplicationRowsByClientRefs({
    clientRefs: refs,
    code: series.code,
  });
  const byRef = new Map(rows.map((row) => [row.clientRef, row]));

  return refs.map((ref) =>
    byRef.has(ref) ? toMember(byRef.get(ref)) : noApplication(ref),
  );
};

export const findApplicationSeries = async ({ clientRef, code }) => {
  const [series] = await findSeriesByClientRefs([clientRef], code);

  if (!series) {
    return null;
  }

  return {
    latestRef: series.latestClientRef,
    refs: [...series.clientRefs],
    members: await membersOf(series),
  };
};

export const applicationExists = async ({ clientRef, code }) => {
  const identifiers = await findApplicationIdentifiers({ clientRef, code });

  return { exists: identifiers !== null, identifiers };
};

export const listGrantCodes = async () =>
  (await findCodes()).toSorted((a, b) => a.localeCompare(b));
