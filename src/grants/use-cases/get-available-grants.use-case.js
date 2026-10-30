import {
  auditActions,
  auditEntities,
  PMC_0706_SECURITY,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { loadGrantsFromConfigVersions } from "../services/resolve-config-version.service.js";
import { GrantAccess } from "../models/grant-access.js";
import { GrantAllowList } from "../models/grant-allow-list.js";
import { findLatestActiveForAll } from "../repositories/config-version.repository.js";
import { findByGrantCodes as findAllowLists } from "../repositories/grant-allow-list.repository.js";
import { findByGrantCodes as findSettings } from "../repositories/grant-settings.repository.js";

const byGrantCode = (items) =>
  new Map(items.map((item) => [item.grantCode, item]));

const getAvailableGrants = async ({ sbi }) => {
  const versions = await findLatestActiveForAll();
  const settings = byGrantCode(
    await findSettings(versions.map((item) => item.grantCode)),
  );
  const openVersions = versions.filter((item) =>
    settings.get(item.grantCode)?.isOpen(),
  );
  const codes = openVersions.map((item) => item.grantCode);
  const [grants, storedLists] = await Promise.all([
    loadGrantsFromConfigVersions(openVersions),
    findAllowLists(codes),
  ]);
  const lists = byGrantCode(storedLists);
  const available = [];
  for (const grant of grants) {
    const grantCode = grant.code;
    const allowList = GrantAllowList.forGrant({
      grantCode,
      grant,
      storedList: lists.get(grantCode),
    });
    const access = new GrantAccess({
      settings: settings.get(grantCode),
      allowList,
    });
    if (access.allowsBusiness({ sbi })) {
      available.push({
        code: grantCode,
        title: grant.title,
        description: grant.metadata.description,
      });
    }
  }
  return { grants: available.toSorted((a, b) => a.code.localeCompare(b.code)) };
};

const buildReadAudit = ({ sbi, caller }, result) =>
  buildAuditEvent({
    entity: auditEntities.GRANT,
    action: auditActions.GET_AVAILABLE_GRANTS,
    entityid: "available-grants",
    segregationRef: sbi,
    details: {
      caller,
      sbi,
      ...(result && { grantCodes: result.grants.map(({ code }) => code) }),
    },
    security: PMC_0706_SECURITY,
  });

export const getAvailableGrantsUseCase = auditedRead(
  getAvailableGrants,
  buildReadAudit,
);
