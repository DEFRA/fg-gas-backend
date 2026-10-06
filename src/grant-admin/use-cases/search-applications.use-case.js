import { logger } from "../../common/logger.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import {
  browseApplications,
  countApplications,
  findApplicationsInSeriesOf,
  listGrantCodes,
} from "../../grants/services/application-read.service.js";
import { PAGE_SIZE, SEARCH, modeOf } from "../services/admin-list.js";

const ONE_PAGE = { endCursor: null, hasNextPage: false };

const isFirstPage = ({ cursor }) => !cursor;

// A ref search is one page, so it is always a first page, with its own total.
const searchPage = async (query) => {
  const [{ rows, total }, codes] = await Promise.all([
    findApplicationsInSeriesOf(query),
    listGrantCodes(),
  ]);

  return { rows, pagination: ONE_PAGE, total, codes };
};

const readFirstPageExtras = async (query) => {
  const [total, codes] = await Promise.all([
    countApplications(query),
    listGrantCodes(),
  ]);

  return { total, codes };
};

const browsePage = async (query) => {
  const [page, extras] = await Promise.all([
    browseApplications({ ...query, pageSize: PAGE_SIZE }),
    isFirstPage(query) ? readFirstPageExtras(query) : {},
  ]);

  return { ...page, ...extras };
};

const toResponseRow = (row) => ({
  ref: { clientRef: row.clientRef, code: row.code },
  position: row.position,
  createdAt: row.createdAt,
  replaced: row.replaced,
});

const searchApplications = async ({ ref, code, from, to, cursor }) => {
  const query = { ref, code, from, to, cursor };
  const mode = modeOf(query);

  logger.info(`Search applications (${mode})`);

  const page = await (mode === SEARCH ? searchPage : browsePage)(query);

  logger.info(`Finished: Search applications (${page.rows.length} rows)`);

  return { ...page, rows: page.rows.map(toResponseRow), sourceErrors: [] };
};

const auditDetails = (args, result) => ({
  caller: args.caller,
  mode: modeOf(args),
  code: args.code,
  from: args.from,
  to: args.to,
  page: isFirstPage(args) ? "first" : "next",
  resultCount: result?.rows.length,
  total: result?.total,
});

// How the list was narrowed, never the ref searched for.
export const buildSearchApplicationsAudit = (args, result) =>
  buildAuditEvent({
    entity: auditEntities.APPLICATION,
    action: auditActions.SEARCH_APPLICATIONS,
    entityid: SEARCH,
    details: {
      ...auditDetails(args, result),
      ...(args.repeat && { repeat: true }),
    },
    security: PMC_0706_SECURITY,
    segregationRef: "admin-search-applications",
  });

export const searchApplicationsUseCase = auditedRead(
  searchApplications,
  buildSearchApplicationsAudit,
);
