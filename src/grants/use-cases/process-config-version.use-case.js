import Boom from "@hapi/boom";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { findS3KeyInManifest, S3FetchError } from "../../common/s3-client.js";
import { markPermanentFailure } from "../../events/retryable.js";
import { parseSemver } from "../../common/semver.js";
import { ConfigVersion } from "../models/config-version.js";
import { upsert } from "../repositories/config-version.repository.js";
import { validateConfigDefinitions } from "./validate-config-definitions.js";

const VALID_STATUSES = ["active", "draft"];

// eslint-disable-next-line complexity
const validateEventData = ({ grantCode, version, status, manifest, path }) => {
  if (!grantCode || !version) {
    throw Boom.badRequest(
      `Config version event missing required fields: grantCode=${grantCode}, version=${version}`,
    );
  }

  if (!path) {
    throw Boom.badRequest(
      `Config version event for ${grantCode}@${version} has no path, so the bucket is unknown`,
    );
  }

  if (!status || !VALID_STATUSES.includes(status)) {
    throw Boom.badRequest(
      `Config version event has invalid status: "${status}" (expected one of: ${VALID_STATUSES.join(", ")})`,
    );
  }

  if (!Array.isArray(manifest) || manifest.length === 0) {
    throw Boom.badRequest(
      "Config version event missing required field: manifest (expected a non-empty array)",
    );
  }

  const parsed = parseSemver(version);
  if (!parsed) {
    throw Boom.badRequest(`Invalid semver version in config event: ${version}`);
  }
};

// Boom covers the bad message and the definition that will not build, both of which will
// be exactly as bad next time. The 5xx codes that mean "try later" are the exception;
// nothing in this path throws one today, and this is here so that stays true if one does.
const TRY_LATER_CODES = new Set([502, 503, 504]);

const cannotBeFixedByRetrying = (error) => {
  if (Boom.isBoom(error)) {
    return !TRY_LATER_CODES.has(error.output.statusCode);
  }

  if (error instanceof S3FetchError) {
    return error.isPermanent || error.isParseError;
  }

  // A definition malformed rather than merely invalid dies on a plain TypeError.
  return error instanceof TypeError;
};

const applyConfigVersion = async (eventData) => {
  const { grantCode, version, status, manifest, path } = eventData;

  validateEventData(eventData);

  logger.info(`Processing config version: ${grantCode}@${version} (${status})`);

  // "path" is the bucket the Config Broker uploaded to. It is the only source: we read
  // from where the files really are, never from a bucket of our own choosing.
  const { variant } = config.configBroker;
  const s3Bucket = path;
  const s3Key = findS3KeyInManifest(manifest, {
    dir: "gas",
    file: "gas.json",
    variant,
  });
  const agreementS3Key = findS3KeyInManifest(manifest, {
    dir: "gas",
    file: "agreement.json",
    variant,
    required: false,
  });
  const paymentS3Key = findS3KeyInManifest(manifest, {
    dir: "gas",
    file: "payment.json",
    variant,
    required: false,
  });

  // Checked before the version is recorded, so a definition nothing can use never becomes
  // something a grant, agreement or payment later resolves to.
  await validateConfigDefinitions({
    grantCode,
    version,
    s3Bucket,
    s3Keys: {
      grant: s3Key,
      agreement: agreementS3Key,
      payment: paymentS3Key,
    },
  });

  const configVersion = ConfigVersion.new({
    grantCode,
    version,
    status,
    s3Key,
    s3Bucket,
  });

  await upsert(configVersion, {
    ...(agreementS3Key && { agreementS3Key }),
    ...(paymentS3Key && { paymentS3Key }),
  });

  logger.info(
    `Upserted config version: ${grantCode}@${version} (s3Key: ${s3Key})`,
  );
};

export const processConfigVersionUseCase = async (eventData) => {
  try {
    await applyConfigVersion(eventData);
  } catch (error) {
    throw cannotBeFixedByRetrying(error) ? markPermanentFailure(error) : error;
  }
};
