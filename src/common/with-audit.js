import { logger } from "./logger.js";
import { writeAuditEvent } from "./write-audit-event.js";

export const withAudit = (f, dataBuilder) =>
  new Proxy(f, {
    async apply(target, _, args) {
      console.log("--------- with audit proxy --------- ");
      console.log("args", args);

      let result;
      let status = "SUCCESS";
      let session = args[1];
      try {
        result = await target.apply(_, args);
      } catch (e) {
        status = "FAILURE";
        session = null;
        throw e;
      } finally {
        console.log(
          "----------- Use case result within proxy ----------- ",
          result,
        );
        const { entities, details, messageGroupId, security } = dataBuilder(
          args,
          result,
        );
        console.log({ entities });
        writeAuditEvent(
          { entities, details, messageGroupId, security, status },
          session,
        ).catch((auditError) => {
          logger.error(auditError, "Failed to write audit event");
        });
      }
      return result;
    },
  });
