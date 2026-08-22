import Boom from "@hapi/boom";
import {
  findConfigDefinition,
  updateDefinitionFetchStatus,
} from "../../common/config-broker/config-catalog.repository.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { logger } from "../../common/logger.js";
import { isMongoDuplicateKeyError } from "../../common/mongo-errors.js";
import { fetchConfigFile, S3FetchError } from "../../common/s3-client.js";
import { PaymentDefinition } from "../models/payment-definition.js";
import {
  findPaymentDefinition,
  insertPaymentDefinition,
} from "../repositories/payment-definition.repository.js";

const definitionType = "payment";
const compiledDefinitions = new Map();
const loadsInFlight = new Map();

const unavailable = (code, version) =>
  Boom.badImplementation(
    `Payment definition "${code}" version "${version}" is unavailable`,
  );

const updateStatus = (target, fetchStatus, fetchError = null) =>
  updateDefinitionFetchStatus({
    grantCode: target.grantCode,
    version: target.version,
    definitionType,
    fetchStatus,
    fetchError,
  });

const s3FailureStatus = (error) =>
  error.isPermanent || error.isParseError
    ? FetchStatus.PermanentError
    : FetchStatus.TransientError;

const failureStatus = (error) => {
  if (error instanceof S3FetchError) {
    return s3FailureStatus(error);
  }

  return Boom.isBoom(error)
    ? FetchStatus.PermanentError
    : FetchStatus.TransientError;
};

const compileDefinition = (rawDefinition, code) => {
  const definition = new PaymentDefinition(rawDefinition);

  if (definition.code !== code) {
    throw Boom.badImplementation(
      `Payment definition code "${definition.code}" does not match "${code}"`,
    );
  }

  return definition;
};

const store = async (target, definition) => {
  try {
    await insertPaymentDefinition({
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

const compileAndStore = async (target, code, cacheKey) => {
  const stored = await findPaymentDefinition(target.grantCode, target.version);
  const rawDefinition =
    stored ?? (await fetchConfigFile(target.s3Bucket, target.s3Key));
  const definition = compileDefinition(rawDefinition, code);

  if (stored === null) {
    await store(target, rawDefinition);
  }
  if (target.fetchStatus !== FetchStatus.Fetched) {
    await updateStatus(target, FetchStatus.Fetched);
  }

  compiledDefinitions.set(cacheKey, definition);
  return definition;
};

const recordFailureStatus = async (target, error) => {
  try {
    await updateStatus(target, failureStatus(error), error.message);
  } catch (statusError) {
    logger.error(
      {
        error: statusError,
        event: { action: "payment-definition-status-update-failed" },
      },
      `Payment definition status update failed for ${target.grantCode}@${target.version}`,
    );
  }
};

const load = async (target, code, cacheKey) => {
  try {
    return await compileAndStore(target, code, cacheKey);
  } catch (error) {
    await recordFailureStatus(target, error);
    logger.error(
      { error, event: { action: "payment-definition-load-failed" } },
      `Payment definition load failed for ${target.grantCode}@${target.version}`,
    );
    throw error;
  }
};

const loadCompiled = (target, code, cacheKey) => {
  const cached = compiledDefinitions.get(cacheKey);
  if (cached) {
    return cached;
  }

  const existing = loadsInFlight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const loading = load(target, code, cacheKey).finally(() =>
    loadsInFlight.delete(cacheKey),
  );
  loadsInFlight.set(cacheKey, loading);
  return loading;
};

export const loadPaymentDefinition = async ({ code, configVersion }) => {
  const target = await findConfigDefinition({
    grantCode: code,
    version: configVersion,
    definitionType,
  });

  if (!target || target.fetchStatus === FetchStatus.PermanentError) {
    throw unavailable(code, configVersion);
  }

  return loadCompiled(target, code, `${code}@${configVersion}`);
};

export const clearPaymentDefinitionCaches = () => {
  compiledDefinitions.clear();
  loadsInFlight.clear();
};
