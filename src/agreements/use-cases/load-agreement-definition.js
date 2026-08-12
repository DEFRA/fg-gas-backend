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
const MAX_FETCH_ATTEMPTS = 5;
const MAX_RESOLUTION_ATTEMPTS = 3;
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

const resolvers = {
  creation: resolveCreation,
  "same-major": resolveSameMajor,
  exact: resolveExact,
};

const findTarget = async (options) => {
  const resolve = resolvers[options.resolution];
  if (!resolve) {
    throw Boom.badImplementation(
      `Unknown Agreement definition resolution "${options.resolution}"`,
    );
  }

  return resolve(options);
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

const guardFetchStatus = async (target) => {
  if (target.fetchStatus === FetchStatus.PermanentError) {
    throw unavailable(target.grantCode, target.version);
  }

  if (
    target.fetchStatus !== FetchStatus.Fetched &&
    target.fetchAttempts >= MAX_FETCH_ATTEMPTS
  ) {
    await updateStatus(
      target,
      FetchStatus.PermanentError,
      `Exceeded ${MAX_FETCH_ATTEMPTS} fetch attempts`,
    );
    throw unavailable(target.grantCode, target.version);
  }
};

const compileDefinition = (rawDefinition, code, version) => {
  if (rawDefinition.code !== code) {
    throw Boom.badImplementation(
      `Agreement definition code "${rawDefinition.code}" does not match "${code}"`,
    );
  }

  // The only place raw producer JSON enters, so the only place that can tell a
  // published configVersion from the platform-applied one below. Validation
  // cannot: it also runs on definitions that legitimately carry the applied
  // value.
  if (rawDefinition.configVersion !== undefined) {
    throw Boom.badImplementation(
      `Agreement definition "${code}" must not declare configVersion; it is applied from the config catalog`,
    );
  }

  // Validate once, here: AgreementDefinition memoises validation by reference,
  // so the constructor below reuses this result instead of re-running Joi.
  const definition = { ...rawDefinition, configVersion: version };
  validateEndpointServiceUrls([validateAgreementDefinition(definition)]);
  return new AgreementDefinition(definition);
};

const loadStored = async (target) => {
  const stored = await findStoredDefinition(target.grantCode, target.version);
  return stored?.definition ?? null;
};

const store = async (target, definition) => {
  try {
    await insertAgreementDefinition({
      code: target.grantCode,
      version: target.version,
      definition,
    });
  } catch (error) {
    // A concurrent request stored the same version first; its copy is identical.
    if (!isMongoDuplicateKeyError(error)) {
      throw error;
    }
  }
};

// Only a Boom error is a defect in the published definition. Anything else is a
// fault in this process or its environment, which leaves the version selectable
// so the next attempt can succeed once the fault is fixed.
const isPermanentDefinitionError = (error) => error.isBoom;

const classifyS3Failure = (error) =>
  error.isPermanent || error.isParseError
    ? FetchStatus.PermanentError
    : FetchStatus.TransientError;

const classifyFailure = (error) => {
  if (error instanceof S3FetchError) {
    return classifyS3Failure(error);
  }

  return isPermanentDefinitionError(error)
    ? FetchStatus.PermanentError
    : FetchStatus.TransientError;
};

const compileAndCache = async (target, stored, cacheKey) => {
  const rawDefinition =
    stored ?? (await fetchConfigFile(target.s3Bucket, target.s3Key));
  const compiled = compileDefinition(
    rawDefinition,
    target.grantCode,
    target.version,
  );

  // Only persist a definition that compiled, so invalid config never lands in
  // the store.
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
  await guardFetchStatus(target);
  const stored = await loadStored(target);

  try {
    return await compileAndCache(target, stored, cacheKey);
  } catch (error) {
    // An env var this instance is missing says nothing about the published
    // definition, so it must not be recorded against the shared config version:
    // that would mark it unusable for every instance, and re-publishing the same
    // version would not clear it. It also must not burn a fetch attempt, which
    // would promote the version to a permanent error after MAX_FETCH_ATTEMPTS.
    if (!(error instanceof EndpointServiceUrlError)) {
      await updateStatus(target, classifyFailure(error), error.message);
    }
    // CDP indexes a curated subset of ECS, so only fields in that subset are
    // searchable: event.action to find these at all, and error.type to pick out
    // the missing-env-var case, whose message names the variables. Arbitrary
    // top-level fields are not indexed, so the detail stays on the error rather
    // than being lifted alongside it. "error", not "err": the logger sets
    // errorKey to match the ECS error fields, and any other key serialises the
    // error as a plain object.
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

  // Share one load per version so concurrent callers do not each fetch from S3
  // and, on failure, each burn one of the fetch attempts.
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

// Only creation and same-major may step back to an older version. exact is the
// accepted-Agreement pin: there is no other version it is allowed to resolve
// to, so a failure there has to surface.
const fallbackResolutions = new Set(["creation", "same-major"]);

// A permanent failure has just excluded this version from resolution, so
// re-resolving yields the next usable one. Transient failures leave it
// selectable and must surface as the service fault they are rather than
// silently downgrading the Agreement to older config.
const shouldFallBack = (resolution, error) =>
  fallbackResolutions.has(resolution) &&
  classifyFailure(error) === FetchStatus.PermanentError;

const reportUnusable = (target, attempt) => {
  if (attempt < MAX_RESOLUTION_ATTEMPTS) {
    logger.warn(
      `Agreement definition ${target.grantCode}@${target.version} is unusable, falling back to an older version`,
    );
    return;
  }

  logger.error(
    `Agreement definition for ${target.grantCode} still unusable after ${MAX_RESOLUTION_ATTEMPTS} attempts`,
  );
};

export const loadAgreementDefinition = async (options) => {
  for (let attempt = 1; attempt <= MAX_RESOLUTION_ATTEMPTS; attempt += 1) {
    const target = await resolveTarget(options);

    try {
      return await loadCompiled(target);
    } catch (error) {
      if (!shouldFallBack(options.resolution, error)) {
        throw error;
      }
      reportUnusable(target, attempt);
    }
  }

  // Exhausting the fallbacks is the same outcome as never finding a usable
  // version, so it surfaces the same error rather than the last raw failure.
  throw unavailable(options.code, options.configVersion);
};

// Routing asks the loader the question it will actually be asked at creation,
// so a grant is only claimed locally when a usable definition exists for that
// application's config version. Anything else belongs to the external service.
//
// This loads rather than just resolving: routing is decided once and written to
// the outbox, so a version that resolves but cannot be fetched or compiled would
// be claimed here and then throw on every redelivery, never reaching the
// external service. The compiled result is cached, so creation reuses it.
export const canLoadDefinitionForCreation = async (options) => {
  try {
    await loadAgreementDefinition({ ...options, resolution: "creation" });
    return true;
  } catch (error) {
    // No usable or parseable version is a routing answer; anything else is a
    // fault that must not quietly divert the command to the external service.
    if (error.isBoom) {
      return false;
    }
    throw error;
  }
};

// Test hook: both caches are module scoped and would otherwise leak between
// cases, letting a test pass against a definition an earlier one cached.
export const clearAgreementDefinitionCaches = () => {
  compiledDefinitions.clear();
  loadsInFlight.clear();
};

// Once accepted, an Agreement is pinned to the definition it was accepted
// under, so what the holder agreed to never changes underneath them. This keys
// off acceptedAt rather than the current state because the pin has to survive
// later transitions: an accepted Agreement can go on to be terminated, and it
// must still render against the version it was accepted under. States reached
// without acceptance (offered, withdrawn, cancelled) have no acceptedAt and
// follow the latest compatible version in their major.
export const loadDefinitionForAgreement = (agreement) =>
  loadAgreementDefinition({
    code: agreement.code,
    configVersion: agreement.configVersion,
    resolution: agreement.acceptedAt ? "exact" : "same-major",
  });
