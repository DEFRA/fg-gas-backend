import Boom from "@hapi/boom";
import {
  findConfigDefinition,
  updateDefinitionFetchStatus,
} from "../../common/config-broker/config-catalog.repository.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { logger } from "../../common/logger.js";
import { fetchConfigFile, S3FetchError } from "../../common/s3-client.js";
import { PaymentDefinition } from "../models/payment-definition.js";

const definitionType = "payment";
const definitions = new Map();
const loadsInFlight = new Map();
const paymentDefinitionErrors = new WeakSet();

const markPaymentDefinitionError = (error) => {
  paymentDefinitionErrors.add(error);
  return error;
};

export const isPaymentDefinitionError = (error) =>
  paymentDefinitionErrors.has(error);

const unavailable = (code, version) =>
  markPaymentDefinitionError(
    Boom.badImplementation(
      `Payment definition "${code}" version "${version}" is unavailable`,
    ),
  );

const updateStatus = (target, fetchStatus, fetchError = null) =>
  updateDefinitionFetchStatus({
    grantCode: target.grantCode,
    version: target.version,
    definitionType,
    fetchStatus,
    fetchError,
  });

const isPermanentS3Failure = (error) =>
  error instanceof S3FetchError && (error.isPermanent || error.isParseError);

const failureStatus = (error) => {
  if (error.isBoom || isPermanentS3Failure(error)) {
    return FetchStatus.PermanentError;
  }
  return FetchStatus.TransientError;
};

const fetchAndCompile = async (target) => {
  if (target.fetchStatus === FetchStatus.PermanentError) {
    throw unavailable(target.grantCode, target.version);
  }

  try {
    const rawDefinition = await fetchConfigFile(target.s3Bucket, target.s3Key);
    const definition = new PaymentDefinition(rawDefinition, {
      code: target.grantCode,
      configVersion: target.version,
    });

    if (target.fetchStatus !== FetchStatus.Fetched) {
      await updateStatus(target, FetchStatus.Fetched);
    }

    return definition;
  } catch (error) {
    await updateStatus(target, failureStatus(error), error.message);
    logger.error(
      { error, event: { action: "payment-definition-load-failed" } },
      `Payment definition load failed for ${target.grantCode}@${target.version}`,
    );
    throw markPaymentDefinitionError(error);
  }
};

const load = (target) => {
  const key = `${target.grantCode}@${target.version}`;
  const cached = definitions.get(key);
  if (cached) {
    return cached;
  }

  const existing = loadsInFlight.get(key);
  if (existing) {
    return existing;
  }

  const loading = fetchAndCompile(target)
    .then((definition) => {
      definitions.set(key, definition);
      return definition;
    })
    .finally(() => loadsInFlight.delete(key));
  loadsInFlight.set(key, loading);
  return loading;
};

export const loadPaymentDefinition = async ({ code, configVersion }) => {
  const target = await findConfigDefinition({
    grantCode: code,
    version: configVersion,
    definitionType,
  });

  if (!target) {
    throw unavailable(code, configVersion);
  }

  return load(target);
};

export const clearPaymentDefinitionCaches = () => {
  definitions.clear();
  loadsInFlight.clear();
};
