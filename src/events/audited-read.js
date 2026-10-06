import { logger } from "../common/logger.js";
import {
  transactionOptions,
  withTransaction,
} from "../common/with-transaction.js";
import { auditStatus } from "./audit-constants.js";
import { writeAuditEvent } from "./write-audit-event.js";

export const AUDIT_COMMIT_MS = 1000;

const writeFailure = async (buildAudit, args, error) => {
  try {
    await writeAuditEvent({
      ...buildAudit(args, null, error),
      status: auditStatus.FAILURE,
    });
  } catch {
    logger.error("Read FAILURE audit not written");
  }
};

// Data is released only once the SUCCESS audit commits. The read itself runs
// outside the transaction, so none spans a call to another service.
export const auditedRead =
  (read, buildAudit, { maxCommitTimeMS = AUDIT_COMMIT_MS } = {}) =>
  async (args) => {
    let result;

    try {
      result = await read(args);
    } catch (error) {
      await writeFailure(buildAudit, args, error);
      throw error;
    }

    await withTransaction(
      (session) =>
        writeAuditEvent(
          { ...buildAudit(args, result), status: auditStatus.SUCCESS },
          session,
        ),
      { ...transactionOptions, maxCommitTimeMS },
    );

    return result;
  };
