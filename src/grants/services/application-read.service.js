import {
  findApplicationIdentifiers,
  findApplicationRowsByClientRefs,
  findApplicationSummaryRow,
  findStoredApplicationDocument,
} from "../repositories/application.repository.js";
import { findSeriesByClientRefs } from "../repositories/application-series.repository.js";

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
