import { logger } from "../../common/logger.js";
import { describeReason } from "./page-sections.js";

// The Event row is never worth holding a version's Overview up for.
export const VERSION_EVENTS_BUDGET_MS = 1500;

const TIMED_OUT = { outcome: "timed-out" };
const FAILED = { outcome: "failed" };

const asRead = ({ content, sourceErrors }) => ({
  outcome: "read",
  events: content.events,
  sourceErrors,
});

// A version's own events, read beside its Overview within the budget: a read
// that ends later is not waited for.
export const readVersionEvents = async (label, read) => {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), VERSION_EVENTS_BUDGET_MS);
  });

  try {
    const answer = await Promise.race([read().then(asRead), late]);

    if (answer === TIMED_OUT) {
      logger.warn(
        `${label}: events took too long; Overview went on without them`,
      );
    }

    return answer;
  } catch (error) {
    logger.warn(`${label}: events unread (${describeReason(error)})`);

    return FAILED;
  } finally {
    clearTimeout(timer);
  }
};
