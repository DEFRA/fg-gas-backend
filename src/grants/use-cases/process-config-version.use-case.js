import Boom from "@hapi/boom";
import { upsertDefinitionLocation } from "../../common/config-broker/config-catalog.repository.js";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { findS3KeyInManifest } from "../../common/s3-client.js";
import { parseSemver } from "../../common/semver.js";
import { ConfigVersion } from "../models/config-version.js";
import { upsert } from "../repositories/config-version.repository.js";

const VALID_STATUSES = ["active", "draft"];

// eslint-disable-next-line complexity
const validateEventData = ({ grantCode, version, status, manifest }) => {
  if (!grantCode || !version) {
    throw Boom.badRequest(
      `Config version event missing required fields: grantCode=${grantCode}, version=${version}`,
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

export const processConfigVersionUseCase = async (eventData) => {
  const { grantCode, version, status, manifest } = eventData;

  validateEventData(eventData);

  logger.info(`Processing config version: ${grantCode}@${version} (${status})`);

  const s3Bucket = config.configBroker.s3Bucket;
  const manifestOptions = { grantCode, version, dir: "gas" };
  const s3Key = findS3KeyInManifest(manifest, {
    ...manifestOptions,
    file: "gas.json",
  });
  const agreementS3Key = findS3KeyInManifest(manifest, {
    ...manifestOptions,
    file: "agreement.json",
    required: false,
  });

  const configVersion = ConfigVersion.new({
    grantCode,
    version,
    status,
    s3Key,
    s3Bucket,
  });

  await upsert(configVersion);

  if (agreementS3Key) {
    await upsertDefinitionLocation({
      grantCode,
      version,
      definitionType: "agreement",
      s3Key: agreementS3Key,
    });
  }

  logger.info(
    `Upserted config version: ${grantCode}@${version} (s3Key: ${s3Key})`,
  );
};
