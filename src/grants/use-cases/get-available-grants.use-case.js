import {
  auditActions,
  auditEntities,
  PMC_0706_SECURITY,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { loadGrantFromConfigVersion } from "../services/resolve-config-version.service.js";
import { GrantAccess } from "../models/grant-access.js";
import { GrantAllowList } from "../models/grant-allow-list.js";
import { findLatestActiveForAll } from "../repositories/config-version.repository.js";
import { findByGrantCodes as findAllowLists } from "../repositories/grant-allow-list.repository.js";
import { findByGrantCodes as findSettings } from "../repositories/grant-settings.repository.js";
import { findByCodesAndVersions } from "../repositories/grant.repository.js";

const byGrantCode = (items) =>
  new Map(items.map((item) => [item.grantCode, item]));

const getAvailableGrants = async ({ sbi, crn }) => {
  const versions = await findLatestActiveForAll();
  const settings = byGrantCode(
    await findSettings(versions.map((item) => item.grantCode)),
  );
  const openVersions = versions.filter((item) =>
    settings.get(item.grantCode)?.isOpen(),
  );
  const codes = openVersions.map((item) => item.grantCode);
  const [storedGrants, storedLists] = await Promise.all([
    findByCodesAndVersions(
      openVersions.filter((item) => item.fetchStatus === FetchStatus.Fetched),
    ),
    findAllowLists(codes),
  ]);
  const grants = new Map(storedGrants.map((grant) => [grant.code, grant]));
  const lists = byGrantCode(storedLists);
  const available = [];
  // Loading is sequential only for the exceptional uncached path: warm reads
  // above are batched and no request fans out unbounded S3 calls.
  for (const version of openVersions) {
    const { grantCode } = version;
    const { grant } = await loadGrantFromConfigVersion(version, {
      storedGrant: grants.get(grantCode) ?? null,
    });
    const allowList = GrantAllowList.forGrant({
      grantCode,
      grant,
      storedList: lists.get(grantCode),
    });
    const access = new GrantAccess({
      settings: settings.get(grantCode),
      allowList,
    });
    if (access.allows({ sbi, crn })) available.push({ code: grantCode });
  }
  return { grants: available.sort((a, b) => a.code.localeCompare(b.code)) };
};

const buildReadAudit = ({ sbi, crn, caller }, result) =>
  buildAuditEvent({
    entity: auditEntities.GRANT,
    action: auditActions.GET_AVAILABLE_GRANTS,
    entityid: "available-grants",
    segregationRef: sbi,
    details: {
      caller,
      sbi,
      crn,
      ...(result && { grantCodes: result.grants.map(({ code }) => code) }),
    },
    security: PMC_0706_SECURITY,
  });

export const getAvailableGrantsUseCase = auditedRead(
  getAvailableGrants,
  buildReadAudit,
);
