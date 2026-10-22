import { logger } from "../../common/logger.js";
import { describeError } from "../repositories/cw-http.js";

// Unknown, not absent, when the other side cannot say: the page still draws.
export const readCounterpart = async (link, probe) => {
  try {
    return { exists: await probe() };
  } catch (error) {
    logger.warn(`${link} unknown (${describeError(error)})`);

    return null;
  }
};
