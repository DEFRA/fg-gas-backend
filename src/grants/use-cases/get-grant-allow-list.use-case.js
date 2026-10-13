import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { GrantAllowList } from "../models/grant-allow-list.js";
import { findByGrantCode } from "../repositories/grant-allow-list.repository.js";
import { assertGrantExists } from "./assert-grant-exists.use-case.js";

const getGrantAllowList = async ({ grantCode }) => {
  await assertGrantExists(grantCode);

  const allowList =
    (await findByGrantCode(grantCode)) ??
    GrantAllowList.unrestricted(grantCode);

  return allowList.toJSON();
};

const buildGetGrantAllowListAudit = ({ grantCode, caller }, result) =>
  buildAuditEvent({
    entity: auditEntities.GRANT,
    action: auditActions.VIEW_ALLOW_LIST,
    entityid: grantCode,
    details: {
      caller,
      ...(result && {
        sbiCount: result.global.sbi.length,
        crnCount: result.global.crn.length,
      }),
    },
    security: PMC_0706_SECURITY,
  });

export const getGrantAllowListUseCase = auditedRead(
  getGrantAllowList,
  buildGetGrantAllowListAudit,
);
