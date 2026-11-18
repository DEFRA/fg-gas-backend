import { beforeDeadline } from "../common/before-deadline.js";
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

const outOfTime = () =>
  Object.assign(new Error("Audited read out of time"), { outOfTime: true });

const readBy = (reading, deadline) =>
  deadline === Infinity
    ? reading
    : beforeDeadline(reading, deadline, outOfTime);

// A read with a deadline bounds the whole audit, its insert too, by the time
// left, so a commit never lands after the read gave up. The driver gives an
// abort a fresh timeout, so the audit is also raced against the deadline and
// a late abort finishes on its own.
const boundsOf = (maxCommitTimeMS, deadline) => {
  if (deadline === Infinity) {
    return { maxCommitTimeMS };
  }

  const left = Math.max(1, deadline - Date.now());

  return { maxCommitTimeMS: Math.min(maxCommitTimeMS, left), timeoutMS: left };
};

const notWritten = (error, deadline) =>
  Object.assign(error, {
    auditNotWritten: true,
    outOfTime: Boolean(error.outOfTime) || Date.now() >= deadline,
  });

const commitViewed = async (
  buildAudit,
  args,
  result,
  { deadline, maxCommitTimeMS },
) => {
  try {
    await readBy(
      withTransaction(
        (session) => {
          if (Date.now() >= deadline) {
            throw outOfTime();
          }

          return writeAuditEvent(
            { ...buildAudit(args, result), status: auditStatus.SUCCESS },
            session,
          );
        },
        { ...transactionOptions, ...boundsOf(maxCommitTimeMS, deadline) },
      ),
      deadline,
    );
  } catch (error) {
    throw notWritten(error, deadline);
  }
};

// Data is released only once the SUCCESS audit commits. The read itself runs
// outside the transaction, so none spans a call to another service. A read
// that `releases` nothing writes no SUCCESS audit. A commit that fails throws
// marked `auditNotWritten`. A read still running at its `deadlineOf` fails
// then, marked `outOfTime`, and whatever it answers later is never audited
// as viewed; the commit must also finish by then.
const DEFAULTS = {
  maxCommitTimeMS: AUDIT_COMMIT_MS,
  releases: () => true,
  deadlineOf: () => Infinity,
};

export const auditedRead = (read, buildAudit, options = {}) => {
  const { maxCommitTimeMS, releases, deadlineOf } = {
    ...DEFAULTS,
    ...options,
  };

  return async (args) => {
    const deadline = deadlineOf(args);
    let result;

    try {
      result = await readBy(read(args), deadline);
    } catch (error) {
      // A FAILURE audit releases nothing, so one still writing is not waited
      // for past the deadline.
      await readBy(writeFailure(buildAudit, args, error), deadline).catch(
        () => {},
      );
      throw error;
    }

    if (!releases(result)) {
      return result;
    }

    await commitViewed(buildAudit, args, result, {
      deadline,
      maxCommitTimeMS,
    });

    return result;
  };
};
