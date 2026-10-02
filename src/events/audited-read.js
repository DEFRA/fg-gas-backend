import { logger } from "../common/logger.js";
import {
  transactionOptions,
  withTransaction,
} from "../common/with-transaction.js";
import { auditStatus } from "./audit-constants.js";
import { writeAuditEvent } from "./write-audit-event.js";

// Within GPA's budget: the read itself may take up to ADMIN_READ_TIMEOUT_MS.
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

/**
 * A read whose data is released only once its SUCCESS audit has committed.
 *
 * The read runs outside any session, so no transaction ever spans a call to
 * another service. A refused or failed read is audited best effort, and the
 * caller still sees the read's own error.
 */
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
