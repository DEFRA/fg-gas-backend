import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { parseSemver } from "../../common/semver.js";
import { updateCurrentConfigVersion } from "../repositories/application.repository.js";
import { findLatestForMajor } from "../repositories/config-version.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";

// Process-level cache of immutable grant definitions keyed by `${code}@${version}`.
// Safe to cache indefinitely: a (code, version) definition never changes.
const MAX_CACHE_ENTRIES = 100;
const definitionCache = new Map();

const cacheKey = (code, version) => `${code}@${version}`;

const getCachedDefinition = (code, version) =>
  definitionCache.get(cacheKey(code, version));

const setCachedDefinition = (code, version, grant) => {
  if (!version || !grant) {
    return;
  }
  if (definitionCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = definitionCache.keys().next().value;
    definitionCache.delete(oldestKey);
  }
  definitionCache.set(cacheKey(code, version), grant);
};

const parseMajor = (version) => {
  const parsed = parseSemver(version);
  if (!parsed) {
    throw Boom.badRequest(`Invalid semver version: ${version}`);
  }
  return parsed.major;
};

// Lazy: serve the immutable definition from the process cache, else pull it from
// the DB/S3 via resolveAndFetchGrant and cache it.
const loadDefinition = async (grantCode, resolvedVersion) => {
  const cached = getCachedDefinition(grantCode, resolvedVersion);
  if (cached) {
    return cached;
  }
  const { grant } = await resolveAndFetchGrant(grantCode, resolvedVersion);
  setCachedDefinition(grantCode, resolvedVersion, grant);
  return grant;
};

const logRollForward = (grantCode, pinnedVersion, resolvedVersion) => {
  if (resolvedVersion !== pinnedVersion) {
    // Observability: an application has rolled forward to a newer config version.
    logger.info(
      `Config version roll-forward for grant ${grantCode}: ${pinnedVersion} -> ${resolvedVersion}`,
    );
  }
};

const resolveRolledForward = async (grantCode, pinnedVersion, major) => {
  const configVersion = await findLatestForMajor(grantCode, major);
  if (!configVersion) {
    throw Boom.notFound(
      `No active config version found for ${grantCode}@${major}.x`,
    );
  }
  const resolvedVersion = configVersion.version;
  const grant = await loadDefinition(grantCode, resolvedVersion);
  logRollForward(grantCode, pinnedVersion, resolvedVersion);
  return { grant, resolvedVersion };
};

const memoResolve = async (memo, key, produce) => {
  if (memo?.has(key)) {
    return memo.get(key);
  }
  const result = await produce();
  memo?.set(key, result);
  return result;
};

// Resolves the grant definition an application should currently use: the latest
// active version within the same major as the application's pinned configVersion.
export const resolveCurrentGrantUseCase = async (
  grantCode,
  pinnedVersion,
  memo,
) => {
  if (!pinnedVersion) {
    return { grant: await findByCode(grantCode), resolvedVersion: null };
  }

  const major = parseMajor(pinnedVersion);
  return memoResolve(memo, cacheKey(grantCode, major), () =>
    resolveRolledForward(grantCode, pinnedVersion, major),
  );
};

export const pinnedVersionOf = (application) =>
  application.currentConfigVersion ?? application.originalConfigVersion;

export const persistResolvedVersion = async (application, resolvedVersion) => {
  if (resolvedVersion && resolvedVersion !== application.currentConfigVersion) {
    await updateCurrentConfigVersion(
      application.clientRef,
      application.code,
      resolvedVersion,
    );
    application.currentConfigVersion = resolvedVersion;
  }
};

// Exposed for tests.
export const __clearGrantDefinitionCache = () => definitionCache.clear();
