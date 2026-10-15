import { wreck } from "../../common/wreck.js";
import {
  cwUrl,
  describeError,
  isCwConfigured,
  requestOptions,
} from "./cw-http.js";

const isRoleList = (appRoles) =>
  Array.isArray(appRoles) &&
  appRoles.every((role) => typeof role?.roleName === "string");

const rolesUnknown = (failure) => ({ roles: null, failure });

const toRoleNames = (payload) => {
  const appRoles = payload?.appRoles;

  return isRoleList(appRoles)
    ? { roles: appRoles.map(({ roleName }) => roleName) }
    : rolesUnknown("Caseworking answered an unreadable body");
};

const userRolesPath = (entraId) =>
  `/api/users/${encodeURIComponent(entraId)}/roles`;

// Never rejects. `roles` is null when they are not known, apart from the empty
// list Caseworking answers for a user it does not know or one with no active
// roles; `failure` says why, for the caller to log if it needed them.
export const findCwUserRoles = async (entraId) => {
  if (!isCwConfigured()) {
    return rolesUnknown("Caseworking is not configured");
  }

  try {
    const { payload } = await wreck.get(
      cwUrl(userRolesPath(entraId)),
      requestOptions(),
    );

    return toRoleNames(payload);
  } catch (error) {
    return rolesUnknown(`Caseworking is unavailable (${describeError(error)})`);
  }
};
