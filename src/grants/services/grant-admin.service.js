import {
  countStored,
  findStored,
  findStoredDocument,
  findStoredIdentifiers,
  findStoredPage,
  findStoredSummary,
} from "../repositories/application.repository.js";
import { findStoredByClientRefs } from "../repositories/application-series.repository.js";
import { findCodes } from "../repositories/grant.repository.js";

// Grant Admin's read-only view of applications. It reads stored documents, not
// Applications, and answers plain data. Nothing here reads inside `answers`.

const TOTAL_CAP = 10_000;
// A series is a handful of records; this only bounds a pathological one.
const SEARCH_CAP = 200;

const ROW_PROJECTION = {
  _id: 1,
  clientRef: 1,
  code: 1,
  currentPhase: 1,
  currentStage: 1,
  currentStatus: 1,
  createdAt: 1,
};

const SUMMARY_PROJECTION = {
  _id: 0,
  clientRef: 1,
  code: 1,
  currentPhase: 1,
  currentStage: 1,
  currentStatus: 1,
  originalConfigVersion: 1,
  currentConfigVersion: 1,
  configVersion: 1,
  submittedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  identifiers: 1,
};

const orNull = (value) => value ?? null;

const toIso = (value) =>
  value instanceof Date ? value.toISOString() : orNull(value);

const toPosition = (doc) => ({
  phase: orNull(doc.currentPhase),
  stage: orNull(doc.currentStage),
  status: orNull(doc.currentStatus),
});

const toIdentifiers = (identifiers) => ({
  sbi: orNull(identifiers?.sbi),
  frn: orNull(identifiers?.frn),
  crn: orNull(identifiers?.crn),
});

// Older documents carry only the single legacy `configVersion`.
const toConfigVersions = (doc) => ({
  originalConfigVersion: orNull(doc.originalConfigVersion ?? doc.configVersion),
  currentConfigVersion: orNull(doc.currentConfigVersion ?? doc.configVersion),
});

const toRow = (doc) => ({
  clientRef: doc.clientRef,
  code: doc.code,
  position: toPosition(doc),
  createdAt: toIso(doc.createdAt),
});

const toSummary = (doc) => ({
  clientRef: doc.clientRef,
  code: doc.code,
  position: toPosition(doc),
  ...toConfigVersions(doc),
  submittedAt: toIso(doc.submittedAt),
  createdAt: toIso(doc.createdAt),
  updatedAt: toIso(doc.updatedAt),
  identifiers: toIdentifiers(doc.identifiers),
});

const toSeries = (doc) => ({
  code: doc.code,
  latestRef: orNull(doc.latestClientRef),
  refs: doc.clientRefs ?? [],
});

// Bounds are compared as stored: ISO strings, normalised to UTC.
const createdAtBounds = ({ from, to }) => ({
  ...(from ? { $gte: new Date(from).toISOString() } : {}),
  ...(to ? { $lte: new Date(to).toISOString() } : {}),
});

const listFilter = ({ code, from, to }) => ({
  ...(code ? { code } : {}),
  ...(from || to ? { createdAt: createdAtBounds({ from, to }) } : {}),
});

const sortKey = (doc) => toIso(doc.createdAt) ?? "";

const newestFirst = (a, b) =>
  sortKey(b).localeCompare(sortKey(a)) ||
  b._id.toString().localeCompare(a._id.toString());

const browse = async ({ code, from, to, cursor, pageSize }) => {
  const page = await findStoredPage({
    filter: listFilter({ code, from, to }),
    projection: ROW_PROJECTION,
    cursor,
    pageSize,
  });

  return { rows: page.data.map(toRow), pagination: page.pagination };
};

// Every member of each series the ref is in, plus the ref itself where it has
// no series. Each branch names a {clientRef, code} pair the unique index serves.
const seriesMatch = (ref, series) => ({
  $or: [
    ...series.map((s) => ({ code: s.code, clientRef: { $in: s.clientRefs } })),
    { clientRef: ref },
  ],
});

const search = async ({ ref, code, from, to }) => {
  const series = await findStoredByClientRefs([ref], code);
  const docs = await findStored(
    { ...seriesMatch(ref, series), ...listFilter({ code, from, to }) },
    { projection: ROW_PROJECTION, limit: SEARCH_CAP + 1 },
  );

  const rows = docs.sort(newestFirst).slice(0, SEARCH_CAP).map(toRow);

  return {
    rows,
    pagination: { endCursor: null, hasNextPage: false },
    total: { count: rows.length, capped: docs.length > SEARCH_CAP },
  };
};

/**
 * A browse, newest first, one keyset page at a time; or, with a ref, every
 * member of that ref's series in one bounded read, with its own total.
 */
export const findApplicationsPage = (query) =>
  query.ref ? search(query) : browse(query);

export const countApplications = async ({ code, from, to }) => {
  const count = await countStored(
    listFilter({ code, from, to }),
    TOTAL_CAP + 1,
  );

  return { count: Math.min(count, TOTAL_CAP), capped: count > TOTAL_CAP };
};

// The application's facts and stored size, or null when there is none.
export const findApplicationSummary = async ({ clientRef, code }) => {
  const stored = await findStoredSummary(
    { clientRef, code },
    SUMMARY_PROJECTION,
  );

  return stored
    ? { summary: toSummary(stored), storedBytes: stored.storedBytes }
    : null;
};

/**
 * The stored document exactly as stored, and its size; a document over
 * `maxBytes` is answered by its size alone, with a null document. Null when
 * there is no such application.
 */
export const findApplicationDocument = async (
  { clientRef, code },
  { maxBytes },
) => {
  const stored = await findStoredDocument({ clientRef, code }, maxBytes);

  if (!stored) {
    return null;
  }

  const { storedBytes: _computed, ...document } = stored.document ?? {};

  return {
    storedBytes: stored.storedBytes,
    document: stored.document ? document : null,
  };
};

export const findApplicationSeries = async ({ clientRefs, code }) =>
  (await findStoredByClientRefs(clientRefs, code)).map(toSeries);

export const applicationExists = async ({ clientRef, code }) => {
  const doc = await findStoredIdentifiers({ clientRef, code });

  return doc
    ? { exists: true, identifiers: toIdentifiers(doc.identifiers) }
    : { exists: false, identifiers: null };
};

export const listGrantCodes = async () => (await findCodes()).sort();
