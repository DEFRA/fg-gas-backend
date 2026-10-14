import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { GrantAllowList } from "../models/grant-allow-list.js";
import { findByGrantCode } from "../repositories/grant-allow-list.repository.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";

const checkGrantAllowList = async ({ grantCode, sbi, crn }) => {
  const { grant } = await resolveAndFetchGrant(grantCode);
  const storedList = await findByGrantCode(grantCode);
  const allowList = GrantAllowList.forGrant({
    grantCode,
    grant,
    storedList,
  });
  return { allowed: allowList.allows({ sbi, crn }) };
};

const buildCheckAudit = ({ grantCode, sbi, crn, caller }, result) =>
  buildAuditEvent({
    entity: auditEntities.GRANT,
    action: auditActions.CHECK_ALLOW_LIST,
    entityid: grantCode,
    details: {
      caller,
      sbi,
      crn,
      ...(result && { allowed: result.allowed }),
    },
    security: PMC_0706_SECURITY,
  });

export const checkGrantAllowListUseCase = auditedRead(
  checkGrantAllowList,
  buildCheckAudit,
);
