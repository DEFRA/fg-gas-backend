import { logger } from "../../common/logger.js";
import {
  transactionOptions,
  withTransaction,
} from "../../common/with-transaction.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditStatus,
} from "../../events/audit-constants.js";
import { AUDIT_COMMIT_MS } from "../../events/audited-read.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import { failedParts, readOverview } from "../services/overview-cache.js";
import { SERVICES } from "../services/overview-reads.js";
import { buildApiClientAudit } from "./api-client-audit.js";

const listingServices = (overview) =>
  SERVICES.filter(
    (service) => overview.tokensExpiring[service].data?.tokens.length > 0,
  );

const auditOf = (who) => (service) => ({
  ...buildApiClientAudit(
    auditActions.VIEW_API_CLIENT,
    PMC_0706_SECURITY,
  )({
    service,
    caller: who.caller,
    actor: who.decodedActor,
  }),
  status: auditStatus.SUCCESS,
});

const writeAudits = (events) =>
  withTransaction(
    async (session) => {
      for (const event of events) {
        await writeAuditEvent(event, session);
      }
    },
    { ...transactionOptions, maxCommitTimeMS: AUDIT_COMMIT_MS },
  );

const withheld = {
  data: null,
  sourceError: { hop: "GAS", reason: "ERRORED" },
};

const withoutTokens = (overview, services) => ({
  ...overview,
  tokensExpiring: {
    ...overview.tokensExpiring,
    ...Object.fromEntries(services.map((service) => [service, withheld])),
  },
});

// Token rows are released, kept or not, only once their view is audited, as
// the tokens page audits it; without the audit they are withheld. A service
// that lists none has released nothing, so nothing is audited for it.
const releaseTokens = async (overview, who) => {
  const services = listingServices(overview);

  if (services.length === 0) {
    return overview;
  }

  try {
    await writeAudits(services.map(auditOf(who)));

    return overview;
  } catch {
    logger.error("Overview tokens withheld: their audit was not written");

    return withoutTokens(overview, services);
  }
};

export const viewOverviewUseCase = async (who) => {
  logger.info("View overview");

  const overview = await releaseTokens(await readOverview(who), who);

  logger.info(
    `Finished: View overview (${failedParts(overview).length} parts not read)`,
  );

  return overview;
};
