import Boom from "@hapi/boom";
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
import { validateEndpointServiceUrls } from "../services/effects/resolve-endpoint-service-url.js";

const definitionType = "agreement";
const MAX_FETCH_ATTEMPTS = 5;
const compiledDefinitions = new Map();

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

const resolveTarget = async (options) => {
  const resolve = resolvers[options.resolution];
  if (!resolve) {
    throw Boom.badImplementation(
      `Unknown Agreement definition resolution "${options.resolution}"`,
    );
  }

  const target = await resolve(options);
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
  if (Object.hasOwn(rawDefinition, "configVersion")) {
    throw Boom.badImplementation(
      `Agreement definition "${code}" must not contain configVersion`,
    );
  }
  if (rawDefinition.code !== code) {
    throw Boom.badImplementation(
      `Agreement definition code "${rawDefinition.code}" does not match "${code}"`,
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

const isPermanentDefinitionError = (error) =>
  error.isBoom || error.message.startsWith("Missing required endpoint URL");

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

const loadCompiled = async (target) => {
  const cacheKey = `${target.grantCode}@${target.version}`;
  const cached = compiledDefinitions.get(cacheKey);
  if (cached) {
    return cached;
  }

  await guardFetchStatus(target);
  const stored = await loadStored(target);

  try {
    return await compileAndCache(target, stored, cacheKey);
  } catch (error) {
    await updateStatus(target, classifyFailure(error), error.message);
    logger.error(
      error,
      `Agreement definition load failed for ${target.grantCode}@${target.version}`,
    );
    throw error;
  }
};

export const loadAgreementDefinition = async (options) => {
  const target = await resolveTarget(options);
  return loadCompiled(target);
};

// An accepted Agreement is pinned to the definition it was accepted under, so
// what the holder agreed to never changes underneath them. Anything still
// offered follows the latest compatible version in its major.
export const loadDefinitionForAgreement = (agreement) =>
  loadAgreementDefinition({
    code: agreement.code,
    configVersion: agreement.configVersion,
    resolution: agreement.state === "accepted" ? "exact" : "same-major",
  });
