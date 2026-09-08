import { auditStatus } from "./audit-constants.js";
import { logger } from "./logger.js";
import { writeAuditEvent } from "./write-audit-event.js";

/**
 * convienience method to use as dataBuilder with withAudit
 */
export const buildAuditEvent = ({
  entity,
  action,
  entityid,
  details = {},
  security,
  segregationRef,
}) => {
  const { sbi, frn, crn, ...rest } = details;
  return {
    entities: [{ entity, action, entityid }],
    details: rest,
    accounts: {
      sbi,
      frn,
      crn,
    },
    // Partitions outbox work only - never published. Falling back to entityid
    // keeps events for one entity on a shared ref so they claim in batches
    // and the fifo_locks collection stays bounded.
    segregationRef: segregationRef ?? entityid,
    ...(security && { security }),
  };
};

/**
 * see https://eaflood.atlassian.net/wiki/spaces/FDM/pages/6241288852/Publishing+Audit+events
 *
 * f: function to wrap. f is called via proxy.apply() and result is passed into dataBuilder
 * dataBuilder: should return object with
 * - entities
 * - accounts
 * - details
 * - security
 * - segregationRef
 */

/**
 * Writes one audit event, and answers with the error the caller must rethrow -
 * or null when there is nothing to be done about it.
 *
 * Outside a transaction an audit failure is logged and swallowed, exactly as
 * it always has been: the action has already happened and refusing to report
 * it would not undo it. Inside one, the audit insert is part of the same
 * commit as the action, so a swallowed failure would let the action land with
 * no audit event - the one outcome auditing exists to prevent. There the error
 * goes back to the caller, which aborts the transaction.
 */
const writeAudit = async (dataBuilder, args, result, status, session) => {
  try {
    const auditData = dataBuilder(args, result);

    if (!auditData) {
      logger.info(
        "withAudit: dataBuilder returned no audit data - skipping audit event.",
      );

      return null;
    }

    const { entities, accounts, details, security, segregationRef } = auditData;

    await writeAuditEvent(
      { entities, accounts, details, status, security, segregationRef },
      session,
    );

    return null;
  } catch (auditError) {
    logger.error(
      auditError,
      `withAudit: Failed to write ${status} audit event.`,
    );

    return session ? auditError : null;
  }
};

export const withAudit = (f, dataBuilder) =>
  new Proxy(f, {
    async apply(target, _, args) {
      logger.info("withAudit: Begin attempt audit with proxy.");

      let result;
      let status = auditStatus.SUCCESS;
      // The caller's transaction, where there is one - `withTransaction` passes
      // it as the second argument, and it carries through to the audit event's
      // own outbox insert so both commit together.
      let session = args[1];
      let auditFailure = null;

      try {
        result = await target.apply(_, args);
      } catch (error) {
        status = auditStatus.FAILURE;
        // Deliberately outside the aborting transaction: a refused attempt is
        // still an attempt, and rolling back would erase the record of it.
        session = null;
        throw error;
      } finally {
        logger.debug(result, "withAudit: Use case result within proxy.");
        auditFailure = await writeAudit(
          dataBuilder,
          args,
          result,
          status,
          session,
        );
      }

      // Reached on the success path alone - a propagating failure never gets
      // here, which is why this is not thrown from the `finally` above: doing
      // that would replace the error the caller actually needs to see.
      if (auditFailure) {
        throw auditFailure;
      }

      logger.info("withAudit: End audit with proxy.");
      return result;
    },
  });
