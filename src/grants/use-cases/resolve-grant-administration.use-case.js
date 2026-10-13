import { GrantAdminAccess } from "../models/grant-admin-access.js";
import { GrantAdministrationDefinition } from "../models/grant-administration-definition.js";
import {
  existsByGrantCode,
  findLatestActive,
} from "../repositories/config-version.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import { fetchGrantDefinition } from "../services/resolve-config-version.service.js";

const currentDefinition = async (grantCode, session) => {
  const version = await findLatestActive(grantCode, session);
  if (version) {
    const source = GrantAdministrationDefinition.select({
      activeVersion: version,
    });
    const { grant } = await fetchGrantDefinition(source.version, session);
    return grant;
  }
  const legacyGrant = await findByCode(grantCode, "0.0.0", session);
  const knownGrant = legacyGrant
    ? true
    : await existsByGrantCode(grantCode, session);
  return GrantAdministrationDefinition.select({ legacyGrant, knownGrant })
    .grant;
};

export const resolveGrantAdministration = async (
  { grantCode, userRoles },
  session,
) => {
  const grant = await currentDefinition(grantCode, session);
  new GrantAdminAccess(grant?.admin).assertAccess(userRoles);
  return grant;
};
