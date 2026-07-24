import Boom from "@hapi/boom";
import { DefinitionSource } from "../../common/definition-source.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { logger } from "../../common/logger.js";
import { fetchConfigFile, S3FetchError } from "../../common/s3-client.js";
import { parseSemver } from "../../common/semver.js";
import {
  findLatestForMajor,
  updateFetchStatus,
} from "../repositories/config-version.repository.js";
import {
  findByCode,
  saveFromDefinition,
} from "../repositories/grant.repository.js";

const MAX_FETCH_ATTEMPTS = 5;
const HTTP_CONFLICT = 409;

const handleS3Error = async (err, grantCode, version) => {
  if (err.isPermanent || err.isParseError) {
    logger.error(err, `Permanent S3 fetch failure for ${grantCode}@${version}`);
    await updateFetchStatus(
      grantCode,
      version,
      FetchStatus.PermanentError,
      err.message,
    );
    throw Boom.badGateway(
      `Permanent S3 error for ${grantCode}@${version}: ${err.message}`,
    );
  }

  logger.error(err, `Transient S3 fetch failure for ${grantCode}@${version}`);
  await updateFetchStatus(
    grantCode,
    version,
    FetchStatus.TransientError,
    err.message,
  );
  throw Boom.serverUnavailable(
    `Transient S3 error for ${grantCode}@${version}: ${err.message}`,
  );
};

const guardFetchStatus = async (configVersion, grantCode, resolvedVersion) => {
  // A successfully fetched version must never be poisoned by the retry limit,
  // even if fetchAttempts accumulated before the fetch succeeded.
  if (configVersion.fetchStatus === FetchStatus.Fetched) {
    return;
  }

  if (configVersion.fetchStatus === FetchStatus.PermanentError) {
    logger.warn(
      `Permanent error recorded for ${grantCode}@${resolvedVersion}: ${configVersion.fetchError}`,
    );
    throw Boom.badGateway(
      `Permanent error for ${grantCode}@${resolvedVersion}: ${configVersion.fetchError}`,
    );
  }

  if (configVersion.fetchAttempts >= MAX_FETCH_ATTEMPTS) {
    logger.warn(
      `Max fetch attempts (${MAX_FETCH_ATTEMPTS}) exceeded for ${grantCode}@${resolvedVersion}`,
    );
    await updateFetchStatus(
      grantCode,
      resolvedVersion,
      FetchStatus.PermanentError,
      `Exceeded ${MAX_FETCH_ATTEMPTS} fetch attempts`,
    );
    throw Boom.badGateway(
      `Max fetch attempts exceeded for ${grantCode}@${resolvedVersion}`,
    );
  }
};

const fetchFromS3 = async (configVersion, grantCode, resolvedVersion) => {
  try {
    return await fetchConfigFile(configVersion.s3Bucket, configVersion.s3Key);
  } catch (err) {
    if (err instanceof S3FetchError) {
      await handleS3Error(err, grantCode, resolvedVersion);
    }
    throw err;
  }
};

const saveOrFallback = async (grantDefinition, grantCode, resolvedVersion) => {
  try {
    const grant = await saveFromDefinition(grantDefinition, resolvedVersion);
    await updateFetchStatus(grantCode, resolvedVersion, FetchStatus.Fetched);
    return grant;
  } catch (err) {
    if (err.isBoom && err.output.statusCode === HTTP_CONFLICT) {
      logger.info(
        `Concurrent insert for ${grantCode}@${resolvedVersion}, loading existing`,
      );
      // The grant exists, so record Fetched here too in case the winning
      // process crashed before updating the status; otherwise the row stays
      // pending and every request re-fetches from S3.
      await updateFetchStatus(grantCode, resolvedVersion, FetchStatus.Fetched);
      return await findByCode(grantCode, resolvedVersion);
    }
    throw err;
  }
};

const fetchAndStoreGrant = async (
  configVersion,
  grantCode,
  resolvedVersion,
) => {
  logger.info(
    `Fetching grant definition from S3 for ${grantCode}@${resolvedVersion}`,
  );

  const grantDefinition = await fetchFromS3(
    configVersion,
    grantCode,
    resolvedVersion,
  );
  const grant = await saveOrFallback(
    grantDefinition,
    grantCode,
    resolvedVersion,
  );

  logger.info(
    `Finished: Resolved and stored ${grantCode}@${resolvedVersion} from S3`,
  );

  return grant;
};

const findStoredGrant = async (configVersion, grantCode, resolvedVersion) => {
  if (configVersion.fetchStatus !== FetchStatus.Fetched) {
    return null;
  }

  const existingGrant = await findByCode(grantCode, resolvedVersion);
  if (existingGrant) {
    logger.info(`Resolved ${grantCode}@${resolvedVersion} from cache`);
  }
  return existingGrant;
};

const resolveConfigVersion = async (grantCode, requestedVersion) => {
  const parsed = parseSemver(requestedVersion);
  if (!parsed) {
    throw Boom.badRequest(`Invalid semver version: ${requestedVersion}`);
  }

  // Roll forward to the latest active version within the same major.
  const configVersion = await findLatestForMajor(grantCode, parsed.major);

  if (!configVersion) {
    throw Boom.notFound(
      `No active config version found for ${grantCode}@${parsed.major}.x`,
    );
  }

  return configVersion;
};

export const resolveAndFetchGrant = async (grantCode, requestedVersion) => {
  logger.info(`Resolving config version for ${grantCode}@${requestedVersion}`);

  const configVersion = await resolveConfigVersion(grantCode, requestedVersion);
  const resolvedVersion = configVersion.version;

  await guardFetchStatus(configVersion, grantCode, resolvedVersion);

  const cached = await findStoredGrant(
    configVersion,
    grantCode,
    resolvedVersion,
  );
  if (cached) {
    return {
      grant: cached,
      resolvedVersion,
      definitionSource: DefinitionSource.MongoDB,
    };
  }

  const grant = await fetchAndStoreGrant(
    configVersion,
    grantCode,
    resolvedVersion,
  );

  return { grant, resolvedVersion, definitionSource: DefinitionSource.S3 };
};
