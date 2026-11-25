import { FetchStatus } from "../../common/fetch-status.js";
import { logger } from "../../common/logger.js";
import { GrantAdminAccess } from "../models/grant-admin-access.js";
import { findLatestActiveForAll } from "../repositories/config-version.repository.js";
import { isDefinitionDefect } from "../services/definition-defect.js";
import { loadGrantsFromConfigVersions } from "../services/resolve-config-version.service.js";

// One grant's definition failing to fetch or build answers Boom or a defect;
// anything else, such as a Mongo failure, fails the whole list.
const isUnloadableGrant = (error) =>
  Boolean(error?.isBoom) || isDefinitionDefect(error);

const loadOne = async (version) => {
  try {
    return await loadGrantsFromConfigVersions([version]);
  } catch (error) {
    if (!isUnloadableGrant(error)) {
      throw error;
    }

    logger.warn(
      error,
      `Left ${version.grantCode}@${version.version} out of the administered grants`,
    );
    return [];
  }
};

// One at a time, as the bulk loader does, to bound S3 fetches.
const loadEach = async (versions) => {
  const grants = [];
  for (const version of versions) {
    grants.push(...(await loadOne(version))); // NOSONAR: Bound exceptional S3 fetch concurrency.
  }
  return grants;
};

const isPermanentlyFailed = (version) =>
  version.fetchStatus === FetchStatus.PermanentError;

const logLeftOut = (version) =>
  logger.warn(
    `Left ${version.grantCode}@${version.version} out of the administered grants: ${version.fetchError}`,
  );

// The loader refuses a version recorded as permanently failed every time, so it
// is left out before loading: one such grant then does not send every other
// grant down the one-by-one path on each request. Left out after each grant's
// latest active version is chosen, so no older version stands in for it.
const findLoadableVersions = async () => {
  const versions = await findLatestActiveForAll();
  versions.filter(isPermanentlyFailed).forEach(logLeftOut);
  return versions.filter((version) => !isPermanentlyFailed(version));
};

// Together while every grant loads; one by one, leaving out the grants that
// cannot, once one does not. The versions are read again before loading one by
// one, because the failed load has updated their fetch status.
const loadCurrentGrants = async () => {
  try {
    return await loadGrantsFromConfigVersions(await findLoadableVersions());
  } catch (error) {
    if (!isUnloadableGrant(error)) {
      throw error;
    }

    return loadEach(await findLoadableVersions());
  }
};

const accessOf = (grant) => new GrantAdminAccess(grant.admin);

// The user's roles are only looked up when some grant has an admin role;
// `findUserRoles` rejects when they cannot be determined.
const heldRolesFor = async (grants, findUserRoles) =>
  grants.some((grant) => accessOf(grant).isConfigured()) ? findUserRoles() : [];

const toSummary = (grant) => ({
  code: grant.code,
  description: grant.metadata.description ?? null,
});

export const findAdministeredGrantsUseCase = async ({ findUserRoles }) => {
  const grants = await loadCurrentGrants();
  const heldRoles = await heldRolesFor(grants, findUserRoles);

  return grants
    .filter((grant) => accessOf(grant).permits(heldRoles))
    .map(toSummary)
    .toSorted((a, b) => a.code.localeCompare(b.code));
};
