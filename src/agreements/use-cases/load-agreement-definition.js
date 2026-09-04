import Boom from "@hapi/boom";
import {
  EndpointServiceUrlError,
  validateEndpointServiceUrls,
} from "../../common/agreements/resolve-endpoint-service-url.js";
import {
  findConfigDefinition,
  findLatestUsableDefinition,
  updateDefinitionFetchStatus,
} from "../../common/config-broker/config-catalog.repository.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { logger } from "../../common/logger.js";
import { isMongoDuplicateKeyError } from "../../common/mongo-errors.js";
import { fetchConfigFile, S3FetchError } from "../../common/s3-client.js";
import { parseSemver } from "../../common/semver.js";
import { AgreementDefinition } from "../models/agreement-definitions/agreement-definition.js";
import { validateAgreementDefinition } from "../models/agreement-definitions/validate.js";
import {
  findAgreementDefinition as findStoredDefinition,
  insertAgreementDefinition,
} from "../repositories/agreement-definition.repository.js";

const definitionType = "agreement";
const compiledDefinitions = new Map();
const loadsInFlight = new Map();

const unavailable = (code, version) =>
  Boom.badImplementation(
    `Agreement definition "${code}" version "${version}" is unavailable`,
  );

const parseVersion = (version) => {
  const parsed = typeof version === "string" ? parseSemver(version) : null;
  if (!parsed) {
    throw unavailable("unknown", version);
  }
  return parsed;
};

const resolveExact = ({ code, configVersion }) =>
  findConfigDefinition({
    grantCode: code,
    version: configVersion,
    definitionType,
  });

const resolveSameMajor = ({ code, configVersion }) => {
  const { major } = parseVersion(configVersion);
  return findLatestUsableDefinition({
    grantCode: code,
    major,
    definitionType,
  });
};

const resolveCreation = async ({ code, configVersion }) => {
  const parsed = parseVersion(configVersion);
  const exact = await resolveExact({ code, configVersion });

  if (
    exact?.status === "active" &&
    exact.fetchStatus !== FetchStatus.PermanentError
  ) {
    return exact;
  }

  return findLatestUsableDefinition({
    grantCode: code,
    ...parsed,
    definitionType,
  });
};

// Exact resolution is pinned; the others may fall back to older versions.
const resolutions = {
  creation: { resolve: resolveCreation, canFallBack: true },
  "same-major": { resolve: resolveSameMajor, canFallBack: true },
  exact: { resolve: resolveExact, canFallBack: false },
};

const findTarget = async (options) => {
  const resolution = resolutions[options.resolution];
  if (!resolution) {
    throw Boom.badImplementation(
      `Unknown Agreement definition resolution "${options.resolution}"`,
    );
  }

  return resolution.resolve(options);
};

const resolveTarget = async (options) => {
  const target = await findTarget(options);
  if (!target) {
    throw unavailable(options.code, options.configVersion);
  }
  return target;
};

const updateStatus = (target, fetchStatus, fetchError = null) =>
  updateDefinitionFetchStatus({
    grantCode: target.grantCode,
    version: target.version,
    definitionType,
    fetchStatus,
    fetchError,
  });

// Only permanent failures make a version unusable.
const guardFetchStatus = (target) => {
  if (target.fetchStatus === FetchStatus.PermanentError) {
    throw unavailable(target.grantCode, target.version);
  }
};

const compileDefinition = (rawDefinition, code, version) => {
  if (rawDefinition.code !== code) {
    throw Boom.badImplementation(
      `Agreement definition code "${rawDefinition.code}" does not match "${code}"`,
    );
  }

  // Producers cannot set the platform-owned configVersion.
  if (rawDefinition.configVersion !== undefined) {
    throw Boom.badImplementation(
      `Agreement definition "${code}" must not declare configVersion; it is applied from the config catalog`,
    );
  }

  const definition = { ...rawDefinition, configVersion: version };
  validateEndpointServiceUrls([validateAgreementDefinition(definition)]);
  return new AgreementDefinition(definition);
};

const loadStored = (target) =>
  findStoredDefinition(target.grantCode, target.version);

const store = async (target, definition) => {
  try {
    await insertAgreementDefinition({
      code: target.grantCode,
      version: target.version,
      definition,
    });
  } catch (error) {
    if (!isMongoDuplicateKeyError(error)) {
      throw error;
    }
  }
};

// Deployment faults are local, so do not record them against shared config.
const recorded = (status) => ({ status, record: true });

const environmentFault = { status: FetchStatus.TransientError, record: false };

// Missing, forbidden or unparseable files cannot recover on retry.
const s3FailureStatus = (error) =>
  error.isPermanent || error.isParseError
    ? FetchStatus.PermanentError
    : FetchStatus.TransientError;

// Boom errors identify invalid definitions; other errors may be transient.
const definitionFailureStatus = (error) =>
  error.isBoom ? FetchStatus.PermanentError : FetchStatus.TransientError;

const classifyFailure = (error) => {
  if (error instanceof EndpointServiceUrlError) {
    return environmentFault;
  }

  if (error instanceof S3FetchError) {
    return recorded(s3FailureStatus(error));
  }

  return recorded(definitionFailureStatus(error));
};

const compileAndCache = async (target, stored, cacheKey) => {
  const rawDefinition =
    stored ?? (await fetchConfigFile(target.s3Bucket, target.s3Key));
  const compiled = compileDefinition(
    rawDefinition,
    target.grantCode,
    target.version,
  );

  if (!stored) {
    await store(target, rawDefinition);
  }
  if (target.fetchStatus !== FetchStatus.Fetched) {
    await updateStatus(target, FetchStatus.Fetched);
  }

  compiledDefinitions.set(cacheKey, compiled);
  return compiled;
};

const load = async (target, cacheKey) => {
  guardFetchStatus(target);
  const stored = await loadStored(target);

  try {
    return await compileAndCache(target, stored, cacheKey);
  } catch (error) {
    const { status, record } = classifyFailure(error);
    if (record) {
      await updateStatus(target, status, error.message);
    }
    // CDP indexes event.action and ECS error fields.
    logger.error(
      { error, event: { action: "agreement-definition-load-failed" } },
      `Agreement definition load failed for ${target.grantCode}@${target.version}`,
    );
    throw error;
  }
};

const loadCompiled = (target) => {
  const cacheKey = `${target.grantCode}@${target.version}`;
  const cached = compiledDefinitions.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Share concurrent loads for the same version.
  const existing = loadsInFlight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const loading = load(target, cacheKey).finally(() =>
    loadsInFlight.delete(cacheKey),
  );
  loadsInFlight.set(cacheKey, loading);
  return loading;
};

// Fall back only when the selected version is permanently unusable.
const shouldFallBack = (resolution, error) =>
  resolutions[resolution].canFallBack &&
  classifyFailure(error).status === FetchStatus.PermanentError;

const reportUnusable = (target) =>
  logger.warn(
    `Agreement definition ${target.grantCode}@${target.version} is unusable, falling back to an older version`,
  );

const reportExhausted = (options) =>
  logger.error(
    { event: { action: "agreement-definition-unavailable" } },
    `No usable Agreement definition for ${options.code} at or below ${options.configVersion}`,
  );

const tryLoad = async (target, options) => {
  try {
    return await loadCompiled(target);
  } catch (error) {
    if (!shouldFallBack(options.resolution, error)) {
      throw error;
    }
    reportUnusable(target);
    return null;
  }
};

export const loadAgreementDefinition = async (options) => {
  const attempted = new Set();

  // Stop when resolution repeats rather than imposing a fallback limit.
  for (;;) {
    const target = await resolveTarget(options);
    const key = `${target.grantCode}@${target.version}`;

    if (attempted.has(key)) {
      break;
    }
    attempted.add(key);

    const definition = await tryLoad(target, options);
    if (definition) {
      return definition;
    }
  }

  reportExhausted(options);
  throw unavailable(options.code, options.configVersion);
};

// Migration dry-runs must prove that an exact definition is usable without
// changing the definition cache or shared fetch status.
export const loadAgreementDefinitionReadOnly = async (options) => {
  const target = await resolveTarget(options);
  guardFetchStatus(target);
  const stored = await loadStored(target);
  const rawDefinition =
    stored ?? (await fetchConfigFile(target.s3Bucket, target.s3Key));
  return compileDefinition(rawDefinition, target.grantCode, target.version);
};

// Reset module caches between tests.
export const clearAgreementDefinitionCaches = () => {
  compiledDefinitions.clear();
  loadsInFlight.clear();
};

// acceptedAt keeps the definition pinned after later state transitions.
export const loadDefinitionForAgreement = (agreement) =>
  loadAgreementDefinition({
    code: agreement.code,
    configVersion: agreement.configVersion,
    resolution: agreement.acceptedAt ? "exact" : "same-major",
  });
