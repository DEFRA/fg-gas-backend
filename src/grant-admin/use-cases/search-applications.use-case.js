import { logger } from "../../common/logger.js";
import {
  ADMIN_READ_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import {
  countApplications,
  findApplicationSeries,
  findApplicationsPage,
  listGrantCodes,
} from "../../grants/services/grant-admin.service.js";
import { PAGE_SIZE } from "../services/merge-event-pages.js";

export const SEARCH = "search";
export const BROWSE = "browse";

export const modeOf = ({ ref }) => (ref ? SEARCH : BROWSE);

const isFirstPage = ({ cursor }) => !cursor;

// A ref search counts its own rows; only a browse needs a separate count.
const readTotal = (query, page) =>
  query.ref ? page.total : countApplications(query);

const readFirstPageExtras = async (query, page) => {
  if (!isFirstPage(query)) {
    return {};
  }

  const [total, codes] = await Promise.all([
    readTotal(query, page),
    listGrantCodes(),
  ]);

  return { total, codes };
};

// Matched on the row's own code: a ref reused under another grant is a
// different application.
const isReplaced = (series, { clientRef, code }) =>
  series.some(
    (s) =>
      s.code === code &&
      s.refs.includes(clientRef) &&
      s.latestRef !== clientRef,
  );

const readSeries = (rows) =>
  rows.length
    ? findApplicationSeries({
        clientRefs: [...new Set(rows.map((row) => row.clientRef))],
      })
    : [];

const toRow = (series) => (row) => ({
  ref: { clientRef: row.clientRef, code: row.code },
  position: row.position,
  createdAt: row.createdAt,
  replaced: isReplaced(series, row),
});

const searchApplications = async ({ ref, code, from, to, cursor }) => {
  const query = { ref, code, from, to, cursor };

  logger.info(`Search applications (${modeOf(query)})`);

  const page = await findApplicationsPage({ ...query, pageSize: PAGE_SIZE });
  const [series, extras] = await Promise.all([
    readSeries(page.rows),
    readFirstPageExtras(query, page),
  ]);

  logger.info(`Finished: Search applications (${page.rows.length} rows)`);

  return {
    rows: page.rows.map(toRow(series)),
    pagination: page.pagination,
    ...extras,
    sourceErrors: [],
  };
};

// How the list was narrowed, never the ref searched for.
export const buildSearchApplicationsAudit = (args, result) =>
  buildAuditEvent({
    entity: auditEntities.APPLICATION,
    action: auditActions.SEARCH_APPLICATIONS,
    entityid: SEARCH,
    details: {
      caller: args.caller,
      mode: modeOf(args),
      code: args.code,
      from: args.from,
      to: args.to,
      page: isFirstPage(args) ? "first" : "next",
      resultCount: result?.rows.length,
      total: result?.total,
      repeat: args.repeat,
    },
    security: ADMIN_READ_SECURITY,
    segregationRef: "admin-search-applications",
  });

export const searchApplicationsUseCase = auditedRead(
  searchApplications,
  buildSearchApplicationsAudit,
);
