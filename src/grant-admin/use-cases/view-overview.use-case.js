import { logger } from "../../common/logger.js";
import { failedParts, readOverview } from "../services/overview-cache.js";

export const viewOverviewUseCase = async (who, checkPart) => {
  logger.info("View overview");

  const overview = await readOverview(who, checkPart);

  logger.info(
    `Finished: View overview (${failedParts(overview).length} parts not read)`,
  );

  return overview;
};
