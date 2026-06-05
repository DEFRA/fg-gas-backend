import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { buildS3Key } from "../../common/s3-client.js";
import { parseSemver } from "../../common/semver.js";
import { ConfigVersion } from "../models/config-version.js";
import { upsert } from "../repositories/config-version.repository.js";

const VALID_STATUSES = ["active", "draft"];

// eslint-disable-next-line complexity
const validateEventData = ({ grantCode, version, status }) => {
  if (!grantCode || !version) {
    throw new Error(
      `Config version event missing required fields: grantCode=${grantCode}, version=${version}`,
    );
  }

  if (!status || !VALID_STATUSES.includes(status)) {
    throw new Error(
      `Config version event has invalid status: "${status}" (expected one of: ${VALID_STATUSES.join(", ")})`,
    );
  }

  const parsed = parseSemver(version);
  if (!parsed) {
    throw new Error(`Invalid semver version in config event: ${version}`);
  }
};

export const processConfigVersionUseCase = async (eventData) => {
  const { grantCode, version, status } = eventData;

  validateEventData(eventData);

  logger.info(`Processing config version: ${grantCode}@${version} (${status})`);

  const s3Bucket = config.configBroker.s3Bucket;
  const s3Key = buildS3Key(grantCode, version);

  const configVersion = ConfigVersion.new({
    grantCode,
    version,
    status,
    s3Key,
    s3Bucket,
  });

  await upsert(configVersion);

  logger.info(
    `Upserted config version: ${grantCode}@${version} (s3Key: ${s3Key})`,
  );
};
