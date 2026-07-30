import Boom from "@hapi/boom";
import { DefinitionSource } from "../../common/definition-source.js";
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
    return { grant: cached, definitionSource: DefinitionSource.Cache };
  }
  const { grant, definitionSource } = await resolveAndFetchGrant(
    grantCode,
    resolvedVersion,
  );
  setCachedDefinition(grantCode, resolvedVersion, grant);
  return { grant, definitionSource };
};

const resolveRolledForward = async (grantCode, major) => {
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
      definitionSource: DefinitionSource.MongoDB,
    };
  }

  const major = parseMajor(pinnedVersion);
  return memoResolve(memo, cacheKey(grantCode, major), () =>
    resolveRolledForward(grantCode, major),
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

const logGrantResolved = (
  { clientRef, code, originalConfigVersion },
  resolvedVersion,
  resolution,
) => {
  const message = [
    "Resolved grant configuration for application",
    `clientRef=${clientRef}`,
    `grantCode=${code}`,
    `originalConfigVersion=${originalConfigVersion ?? "none"}`,
    `resolvedConfigVersion=${resolvedVersion ?? "none"}`,
    `resolutionType=${resolution.resolutionType}`,
    `definitionSource=${resolution.definitionSource}`,
  ].join(" ");

  logger.info(
    {
      event: {
        action: "application-grant-resolved",
        outcome: "success",
        reference: clientRef,
        reason: resolution.resolutionType,
      },
    },
    message,
  );
};

const logGrantResolutionFailure = (
  { clientRef, code, originalConfigVersion },
  requestedVersion,
  err,
) => {
  const message = [
    "Failed to resolve grant configuration for application",
    `clientRef=${clientRef}`,
    `grantCode=${code}`,
    `originalConfigVersion=${originalConfigVersion ?? "none"}`,
    `requestedVersion=${requestedVersion ?? "none"}`,
    `error=${err.message}`,
  ].join(" ");

  logger.error(
    {
      event: {
        action: "application-grant-resolved",
        outcome: "failure",
        reference: clientRef,
        reason: err.message,
      },
      error: { message: err.message },
    },
    message,
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
  const submissionRef = {
    clientRef,
    code,
    originalConfigVersion: requestedVersion,
  };
  try {
    const { grant, resolvedVersion, definitionSource } =
      await resolveAndFetchGrant(code, requestedVersion);

    const resolutionType =
      resolvedVersion === requestedVersion ? "version-match" : "roll-forward";

    logGrantResolved(submissionRef, resolvedVersion, {
      resolutionType,
      definitionSource,
    });

    return { grant, resolvedVersion };
  } catch (err) {
    logGrantResolutionFailure(submissionRef, requestedVersion, err);
    throw err;
  }
};

// Exposed for tests.
export const _clearGrantDefinitionCache = () => definitionCache.clear();
