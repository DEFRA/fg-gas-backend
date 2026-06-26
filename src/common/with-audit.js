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
  messageGroupId,
  security,
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
    messageGroupId: messageGroupId ?? entityid,
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
 * - messageGroupId
 * - security
 */

export const withAudit = (f, dataBuilder) =>
  new Proxy(f, {
    async apply(target, _, args) {
      logger.info("Begin attempt audit with proxy.");

      let result;
      let status = auditStatus.SUCCESS;
      let session = args[1];

      try {
        result = await target.apply(_, args);
      } catch (error) {
        status = auditStatus.FAILURE;
        session = null;
        throw error;
      } finally {
        logger.debug(result, "Use case result within proxy.");
        try {
          const { entities, accounts, details, messageGroupId, security } =
            dataBuilder(args, result);

          await writeAuditEvent(
            {
              entities,
              accounts,
              details,
              messageGroupId,
              status,
              security,
            },
            session,
          );
        } catch (auditError) {
          logger.error(auditError, `Failed to write ${status} audit event.`);
        }
      }

      logger.info("End audit with proxy.");
      return result;
    },
  });
