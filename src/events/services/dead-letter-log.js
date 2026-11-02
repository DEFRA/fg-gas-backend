import { logger } from "../../common/logger.js";

export const DeadLetterReason = {
  RETRIES_EXHAUSTED: "retries_exhausted",
  MISSING_SEGREGATION_REF: "missing_segregation_ref",
  NON_RETRYABLE: "non_retryable",
};

export const logDeadLetter = (box, reason, { _id, eventType, errorKey }) => {
  logger.warn(
    {
      event: {
        action: "dead_letter",
        category: box,
        type: eventType,
        reason,
        reference: String(_id),
      },
      error: { code: errorKey },
    },
    `Event ${_id} in ${box} became a dead letter`,
  );
};

// CDP's log pipeline keeps no numeric event field that could carry a count.
export const logDeadLettersSwept = (box, count) => {
  logger.warn(
    {
      event: {
        action: "dead_letter",
        category: box,
        reason: DeadLetterReason.RETRIES_EXHAUSTED,
        reference: String(count),
      },
    },
    `${count} events in ${box} became dead letters`,
  );
};
