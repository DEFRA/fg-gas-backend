import { refuse } from "../../common/buckets/refusal.js";
import { logger } from "../../common/logger.js";
import { describeDetails } from "./safe-fail-action.js";

export const bucketFailAction = (_request, _h, error) => {
  logger.warn(`Query bucket request refused: ${describeDetails(error)}`);

  throw refuse("INVALID_REQUEST");
};
