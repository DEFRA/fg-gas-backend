import { GrantAdminAccess } from "../models/grant-admin-access.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";

export const resolveGrantAdministration = async ({ grantCode, userRoles }) => {
  const { grant } = await resolveAndFetchGrant(grantCode);
  new GrantAdminAccess(grant?.admin).assertAccess(userRoles);
};
