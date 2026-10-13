import { GrantAdminAccess } from "../models/grant-admin-access.js";
import { findLatestActive } from "../repositories/config-version.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";
import { assertGrantExists } from "./assert-grant-exists.use-case.js";

const currentDefinition = async (grantCode, session) => {
  const version = await findLatestActive(grantCode, session);
  if (version) {
    const { grant } = await resolveAndFetchGrant(
      grantCode,
      version.version,
      session,
    );
    return grant;
  }
  return findByCode(grantCode, "0.0.0", session);
};

export const assertGrantAdminAccess = async (
  { grantCode, userRoles },
  session,
) => {
  await assertGrantExists(grantCode, session);
  const grant = await currentDefinition(grantCode, session);
  new GrantAdminAccess(grant?.admin).assertAccess(userRoles);
};
