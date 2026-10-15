import { GrantAdminAccess } from "../models/grant-admin-access.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";

// The user's roles are only looked up for a grant that has an admin role;
// `findUserRoles` rejects when they cannot be determined.
export const resolveGrantAdministration = async ({
  grantCode,
  findUserRoles,
}) => {
  const { grant } = await resolveAndFetchGrant(grantCode);
  const access = new GrantAdminAccess(grant?.admin);

  access.assertConfigured();
  access.assertAccess(await findUserRoles());
};
