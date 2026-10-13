import { GrantAdminAccess } from "../models/grant-admin-access.js";
import { GrantAdministrationDefinition } from "../models/grant-administration-definition.js";
import { findLatestActive } from "../repositories/config-version.repository.js";
import { fetchGrantDefinition } from "../services/resolve-config-version.service.js";

const currentDefinition = async (grantCode, session) => {
  const activeVersion = await findLatestActive(grantCode, session);
  const source = GrantAdministrationDefinition.select({ activeVersion });
  const { grant } = await fetchGrantDefinition(source.version, session);
  return grant;
};

export const resolveGrantAdministration = async (
  { grantCode, userRoles },
  session,
) => {
  const grant = await currentDefinition(grantCode, session);
  new GrantAdminAccess(grant?.admin).assertAccess(userRoles);
  return grant;
};
