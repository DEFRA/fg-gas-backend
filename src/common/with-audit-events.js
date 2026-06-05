import { logger } from "./logger.js";
import { FAILURE, SUCCESS, writeAuditEvent } from "./write-audit-event.js";

const handleSuccessWrite = async (writePromise, session) => {
  if (!session) {
    logger.warn(
      "withAuditEvents: audit event written outside transaction — did you forget to return session from buildAuditEvent?",
    );
    return;
  }
  await writePromise;
};

const attemptWriteAuditEvent = async ({
  args,
  result,
  status,
  buildAuditEvent,
}) => {
  logger.info({ status, args }, "attemp to write audit event");

  const { entities, details, messageGroupId, security, session } =
    buildAuditEvent({ args, result, status });

  logger.info(
    { entities, details, messageGroupId, security, session },
    "built event",
  );

  const writePromise = writeAuditEvent(
    { entities, details, messageGroupId, status, security },
    status === SUCCESS ? session : undefined,
  ).catch((err) => logger.error({ err }, "Failed to write audit event"));

  if (status === SUCCESS) {
    await handleSuccessWrite(writePromise, session);
  }
};

/**
 * args {
 *   command: use case parameters
 *   session?: transactional session
 * }
 */
export const withAuditEvents =
  (fn, buildAuditEvent) =>
  async (...args) => {
    logger.info(args, "Executing withAuditEvent");
    let status = SUCCESS;
    let result;
    try {
      result = await fn(...args);
      logger.info(result, "withAuditEvents results");
      return result;
    } catch (e) {
      logger.error(e, "withAuditEvents failed");
      status = FAILURE;
      throw e;
    } finally {
      await attemptWriteAuditEvent({
        args,
        result,
        status,
        buildAuditEvent,
      });
    }
  };
