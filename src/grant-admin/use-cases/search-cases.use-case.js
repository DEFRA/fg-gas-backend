import { logger } from "../../common/logger.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { searchCwCases } from "../repositories/cw-actuators.repository.js";
import { SEARCH, modeOf } from "../services/admin-list.js";

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

  const page = await searchCwCases(query, { actor, repeat });

  logger.info(`Finished: Search cases (${page.rows.length} rows)`);

  return { ...page, sourceErrors: [] };
};

const auditDetails = (args, result) => ({
  caller: args.caller,
  mode: modeOf(args),
  workflowCode: args.workflowCode,
  from: args.from,
  to: args.to,
  page: args.cursor ? "next" : "first",
  resultCount: result?.rows.length,
  total: result?.total,
});

// How the list was narrowed, never the ref searched for.
export const buildSearchCasesAudit = (args, result) =>
  buildAuditEvent({
    entity: auditEntities.CASE,
    action: auditActions.SEARCH_CASES,
    entityid: SEARCH,
    details: {
      ...auditDetails(args, result),
      ...(args.repeat && { repeat: true }),
    },
    security: PMC_0706_SECURITY,
    segregationRef: "admin-search-cases",
  });

export const searchCasesUseCase = auditedRead(
  searchCases,
  buildSearchCasesAudit,
);
