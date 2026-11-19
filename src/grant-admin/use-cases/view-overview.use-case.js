import { logger } from "../../common/logger.js";
import { failedParts, readOverview } from "../services/overview-cache.js";
import {
  OVERVIEW_BUDGET_MS,
  linkTopErrors,
} from "../services/overview-reads.js";
import { readShell } from "../services/shell-cache.js";

const linkedTo = (catalogue, topErrors) =>
  Object.fromEntries(
    Object.entries(topErrors).map(([service, read]) => [
      service,
      linkTopErrors(read, catalogue),
    ]),
  );

// The Overview is kept, but the catalogue its Top errors link into is read for
// each answer, as the shell it is drawn in is.
export const viewOverviewUseCase = async (who, checkPart) => {
  logger.info("View overview");

  const [overview, shell] = await Promise.all([
    readOverview(who, checkPart),
    readShell(Date.now() + OVERVIEW_BUDGET_MS),
  ]);

  logger.info(
    `Finished: View overview (${failedParts(overview).length} parts not read)`,
  );

  return {
    ...overview,
    topErrors: linkedTo(shell?.catalogue ?? null, overview.topErrors),
  };
};
