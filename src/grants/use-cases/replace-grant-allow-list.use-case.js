import Boom from "@hapi/boom";
import { withTransaction } from "../../common/with-transaction.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import { GrantAllowList } from "../models/grant-allow-list.js";
import {
  findByGrantCode,
  replace,
} from "../repositories/grant-allow-list.repository.js";
import { resolveGrantAdministration } from "./resolve-grant-administration.use-case.js";

const countsOf = ({ global }) => ({
  sbiCount: global.sbi.length,
  crnCount: global.crn.length,
});

const replaceGrantAllowList = async (args, session) => {
  const grant = await resolveGrantAdministration(args, session);
  const { grantCode, global } = args;

  const allowList =
    (await findByGrantCode(grantCode, session)) ??
    GrantAllowList.unrestricted(grantCode);
  const previousCounts = countsOf(allowList.toJSON());
  const previousGlobal = allowList.toJSON().global;

  allowList.replaceGlobal(global);
  await replace(allowList, session);

  return {
    representation: { ...allowList.toJSON(), adminRole: grant.admin.role },
    previousCounts,
    previousGlobal,
  };
};

const DOMAIN_ERROR_CODES = new Set(["ALLOW_LIST_VALIDATION_FAILED"]);

const statusErrorCodes = {
  403: "GRANT_ADMIN_ACCESS_DENIED",
  404: "GRANT_NOT_FOUND",
};

const errorCodeOf = (error) => {
  if (!Boom.isBoom(error)) {
    return "UNEXPECTED_FAILURE";
  }

  const domainErrorCode = error.output.payload.errorCode;

  if (DOMAIN_ERROR_CODES.has(domainErrorCode)) {
    return domainErrorCode;
  }

  return statusErrorCodes[error.output.statusCode] ?? "UNEXPECTED_FAILURE";
};

const buildReplaceGrantAllowListAudit = (
  [{ grantCode, caller }],
  result,
  error,
) =>
  buildAuditEvent({
    entity: auditEntities.GRANT,
    action: auditActions.REPLACE_ALLOW_LIST,
    entityid: grantCode,
    details: {
      caller,
      ...(error
        ? { errorCode: errorCodeOf(error) }
        : {
            oldSbiCount: result.previousCounts.sbiCount,
            oldCrnCount: result.previousCounts.crnCount,
            newSbiCount: result.representation.global.sbi.length,
            newCrnCount: result.representation.global.crn.length,
            oldGlobal: result.previousGlobal,
            newGlobal: result.representation.global,
          }),
    },
    security: PMC_0706_SECURITY,
  });

const replaceGrantAllowListWithAudit = withAudit(
  replaceGrantAllowList,
  buildReplaceGrantAllowListAudit,
);

export const replaceGrantAllowListUseCase = async (args) => {
  const result = await withTransaction((session) =>
    replaceGrantAllowListWithAudit(args, session),
  );

  return result.representation;
};
