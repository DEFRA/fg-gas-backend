import { GrantAdminAccess } from "../models/grant-admin-access.js";
import { findLatestActive } from "../repositories/config-version.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";
import { assertGrantExists } from "./assert-grant-exists.use-case.js";

const currentDefinition = async (grantCode) => {
  const version = await findLatestActive(grantCode);
  if (version) {
    const { grant } = await resolveAndFetchGrant(grantCode, version.version);
    return grant;
  }
  return findByCode(grantCode);
};

export const assertGrantAdminAccess = async (
  { grantCode, userRoles },
  session,
) => {
  await assertGrantExists(grantCode, session);
  const grant = await currentDefinition(grantCode);
  new GrantAdminAccess(grant?.admin).assertAccess(userRoles);
};
