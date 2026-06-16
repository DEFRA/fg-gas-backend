import { logger } from "./logger.js";
import { withTransaction } from "./with-transaction.js";
import { FAILURE, SUCCESS, writeAuditEvent } from "./write-audit-event.js";

const writeAudit = async ({ audit, args, result, status, session }) => {
  const auditEvent = audit({ args, result, status });

  await writeAuditEvent({ ...auditEvent, status }, session).catch((err) =>
    logger.error({ err }, "Failed to write audit event"),
  );
};

const runWithTransaction = async ({ run, audit, args }) => {
  let result;

  return withTransaction(
    async (session) => {
      result = await run(session, ...args);
      return result;
    },
    async (session) => {
      await writeAudit({
        audit,
        args,
        result,
        status: session ? SUCCESS : FAILURE,
        session,
      });
    },
  );
};

const runUnmanaged = async ({ run, audit, getSession, args }) => {
  let result;
  let status = SUCCESS;
  try {
    result = await run(...args);
    return result;
  } catch (err) {
    status = FAILURE;
    throw err;
  } finally {
    await writeAudit({
      audit,
      args,
      result,
      status,
      session: getSession?.({ args }),
    });
  }
};

export const withAudit =
  ({ run, audit, transactional = false, getSession }) =>
  async (...args) => {
    if (transactional) {
      return runWithTransaction({ run, audit, args });
    }
    return runUnmanaged({ run, audit, getSession, args });
  };
