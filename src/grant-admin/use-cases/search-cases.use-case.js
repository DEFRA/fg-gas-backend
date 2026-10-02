import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import {
  ADMIN_READ_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import {
  describeError,
  searchCwCases,
} from "../repositories/cw-actuators.repository.js";
import { SEARCH, modeOf } from "../services/list-mode.js";

const toRow = (summary) => ({
  ref: {
    caseRef: summary.ref.caseRef,
    workflowCode: summary.ref.workflowCode,
  },
  position: summary.position,
  closed: summary.closed,
  closedAt: summary.closedAt,
  createdAt: summary.createdAt,
});

const firstPageExtras = ({ total, workflowCodes }) => ({
  ...(total ? { total } : {}),
  ...(workflowCodes ? { workflowCodes } : {}),
});

const BAD_REQUEST = 400;

const isRefusedQuery = (error) => error.output?.statusCode === BAD_REQUEST;

// The list has no other source, so Caseworking being down is the call
// failing. A query it refused, such as a stale cursor, is still a 400.
const readCases = async (query, operator) => {
  try {
    return await searchCwCases(query, operator);
  } catch (error) {
    logger.warn(
      `Search cases: caseworking refused or unavailable (${describeError(error)})`,
    );

    throw isRefusedQuery(error)
      ? error
      : Boom.badGateway("Cases could not be loaded from Caseworking");
  }
};

const searchCases = async ({
  ref,
  workflowCode,
  from,
  to,
  cursor,
  actor,
  repeat,
}) => {
  const query = { ref, workflowCode, from, to, cursor };

  logger.info(`Search cases (${modeOf(query)})`);

  const answer = await readCases(query, { actor, repeat });

  logger.info(`Finished: Search cases (${answer.cases.length} rows)`);

  return {
    rows: answer.cases.map(toRow),
    pagination: answer.pagination,
    ...firstPageExtras(answer),
    sourceErrors: [],
  };
};

// How the list was narrowed, never the ref searched for.
export const buildSearchCasesAudit = (args, result) =>
  buildAuditEvent({
    entity: auditEntities.CASE,
    action: auditActions.SEARCH_CASES,
    entityid: SEARCH,
    details: {
      caller: args.caller,
      mode: modeOf(args),
      workflowCode: args.workflowCode,
      from: args.from,
      to: args.to,
      page: args.cursor ? "next" : "first",
      resultCount: result?.rows.length,
      total: result?.total,
      repeat: args.repeat,
    },
    security: ADMIN_READ_SECURITY,
    segregationRef: "admin-search-cases",
  });

export const searchCasesUseCase = auditedRead(
  searchCases,
  buildSearchCasesAudit,
);
