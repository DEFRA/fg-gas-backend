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
    return { grant: cached, definitionSource: "cache" };
  }
  const { grant, definitionSource } = await resolveAndFetchGrant(
    grantCode,
    resolvedVersion,
  );
  setCachedDefinition(grantCode, resolvedVersion, grant);
  return { grant, definitionSource };
};

const resolveRolledForward = async (grantCode, pinnedVersion, major) => {
  const configVersion = await findLatestForMajor(grantCode, major);
  if (!configVersion) {
    throw Boom.notFound(
      `No active config version found for ${grantCode}@${major}.x`,
    );
  }
  const resolvedVersion = configVersion.version;
  const { grant, definitionSource } = await loadDefinition(
    grantCode,
    resolvedVersion,
  );
  return { grant, resolvedVersion, definitionSource };
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
    return {
      grant: await findByCode(grantCode),
      resolvedVersion: null,
      definitionSource: "mongodb",
    };
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

const determineResolutionType = (pinnedVersion, resolvedVersion) => {
  if (!pinnedVersion) {
    return "legacy";
  }
  if (resolvedVersion !== pinnedVersion) {
    return "roll-forward";
  }
  return "version-match";
};

const logGrantResolved = (application, resolvedVersion, resolution) => {
  logger.info(
    {
      event: { action: "application-grant-resolved", outcome: "success" },
      application: { clientRef: application.clientRef },
      grant: {
        code: application.code,
        originalConfigVersion: application.originalConfigVersion,
        resolvedConfigVersion: resolvedVersion,
        resolutionType: resolution.resolutionType,
        definitionSource: resolution.definitionSource,
      },
    },
    "Resolved grant configuration for application",
  );
};

const logGrantResolutionFailure = (application, requestedVersion, err) => {
  logger.error(
    {
      event: { action: "application-grant-resolved", outcome: "failure" },
      application: { clientRef: application.clientRef },
      grant: {
        code: application.code,
        originalConfigVersion: application.originalConfigVersion,
        requestedVersion,
        resolvedConfigVersion: null,
      },
      error: { message: err.message },
    },
    "Failed to resolve grant configuration for application",
  );
};

// Resolves and logs the grant for an existing application.
// Wraps resolveCurrentGrantUseCase with structured success/error logging.
export const resolveGrantForApplication = async (application, memo) => {
  const pinned = pinnedVersionOf(application);
  try {
    const { grant, resolvedVersion, definitionSource } =
      await resolveCurrentGrantUseCase(application.code, pinned, memo);

    if (!grant) {
      throw Boom.notFound(`Grant with code "${application.code}" not found`);
    }

    const resolutionType = determineResolutionType(pinned, resolvedVersion);
    const result = { grant, resolvedVersion, definitionSource, resolutionType };
    logGrantResolved(application, resolvedVersion, result);
    return result;
  } catch (err) {
    logGrantResolutionFailure(application, pinned, err);
    throw err;
  }
};

// Resolves and logs the grant at submission time, before the application exists.
// Uses resolveAndFetchGrant directly since there is no pinned version yet.
export const resolveGrantForSubmission = async ({
  code,
  clientRef,
  requestedVersion,
}) => {
  try {
    const { grant, resolvedVersion, definitionSource } =
      await resolveAndFetchGrant(code, requestedVersion);

    const resolutionType =
      resolvedVersion === requestedVersion ? "version-match" : "roll-forward";

    logger.info(
      {
        event: { action: "application-grant-resolved", outcome: "success" },
        application: { clientRef },
        grant: {
          code,
          originalConfigVersion: requestedVersion,
          resolvedConfigVersion: resolvedVersion,
          resolutionType,
          definitionSource,
        },
      },
      "Resolved grant configuration for application",
    );

    return { grant, resolvedVersion };
  } catch (err) {
    logger.error(
      {
        event: { action: "application-grant-resolved", outcome: "failure" },
        application: { clientRef },
        grant: {
          code,
          originalConfigVersion: requestedVersion,
          requestedVersion,
          resolvedConfigVersion: null,
        },
        error: { message: err.message },
      },
      "Failed to resolve grant configuration for application",
    );
    throw err;
  }
};

// Exposed for tests.
export const __clearGrantDefinitionCache = () => definitionCache.clear();
