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

// One entry per resolution, holding both choices it implies: how it finds a
// target, and whether it may step back to an older version when that target
// turns out to be unusable. exact is the accepted-Agreement pin, which has no
// other version it is allowed to resolve to, so a failure there has to surface.
// Keeping the two together means adding a resolution cannot silently inherit a
// fallback answer nobody chose.
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

// A version is unusable only when something permanent made it so. Counting
// attempts here condemned versions that were fine: fetchAttempts is shared
// across the fleet, so a few seconds of S3 trouble exhausted it, and the state
// it wrote was unrecoverable. The case it was meant to stop — a dead or
// forbidden S3 key — already classifies as permanent on the first attempt.
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
    // A concurrent request stored the same version first; its copy is identical.
    if (!isMongoDuplicateKeyError(error)) {
      throw error;
    }
  }
};

// What a load failure means, in one place. Two questions, answered together
// because they interact:
//
//   status  what the failure says about the version itself. Permanent takes it
//           out of resolution for good, so only a defect in the published
//           definition earns it.
//   record  whether that verdict belongs on the shared config version at all.
//
// The pairing is the point. An environment fault is transient *and* unrecorded:
// the same definition is fine on an instance that has the env var, so writing
// anything against the version would condemn it for the whole fleet over a gap
// in this deployment. Everything else is recorded, because it is a fact about
// the config rather than about us.
//
// Whether a failure may send resolution back to an older release is not here:
// that also depends on the resolution in play, so shouldFallBack combines this
// verdict with the resolution's own answer.
const recorded = (status) => ({ status, record: true });

const environmentFault = { status: FetchStatus.TransientError, record: false };

// 404 and 403 are a dead or forbidden key, and unparseable JSON will not become
// parseable; neither is worth another attempt. Any other S3 error might be.
const s3FailureStatus = (error) =>
  error.isPermanent || error.isParseError
    ? FetchStatus.PermanentError
    : FetchStatus.TransientError;

// Boom is thrown by the code and schema checks in compileDefinition, so it means
// the definition is defective. A plain Error is this process failing, which says
// nothing about the version and leaves it selectable.
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
  guardFetchStatus(target);
  const stored = await loadStored(target);

  try {
    return await compileAndCache(target, stored, cacheKey);
  } catch (error) {
    const { status, record } = classifyFailure(error);
    if (record) {
      await updateStatus(target, status, error.message);
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

// A permanent failure has just excluded this version from resolution, so
// re-resolving yields the next usable one. Transient failures leave it
// selectable and must surface as the service fault they are rather than
// silently downgrading the Agreement to older config.
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

// Null rather than a throw when the version was unusable and this resolution is
// allowed to step back to an older one, so the walk below reads as a loop over
// candidates instead of control flow through a catch.
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
  // Keep stepping back for as long as resolution offers a version not already
  // tried here, rather than counting to a fixed number of releases: three
  // consecutive broken ones used to end the walk while an older usable version
  // was still sitting there.
  const attempted = new Set();

  // Bounded by the versions on offer rather than a count of them: each pass
  // either records a version not seen before or stops, so this cannot run longer
  // than there are versions for the grant, and resolveTarget throws once none is
  // left. A number here could only cut the walk short of a usable release.
  for (;;) {
    const target = await resolveTarget(options);
    const key = `${target.grantCode}@${target.version}`;

    // The same version twice means the walk has stopped making progress, so
    // there is nothing older left to step to.
    if (attempted.has(key)) {
      break;
    }
    attempted.add(key);

    const definition = await tryLoad(target, options);
    if (definition) {
      return definition;
    }
  }

  // Exhausting the fallbacks is the same outcome as never finding a usable
  // version, so it surfaces the same error rather than the last raw failure.
  reportExhausted(options);
  throw unavailable(options.code, options.configVersion);
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
