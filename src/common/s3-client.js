import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "./config.js";
import { logger } from "./logger.js";

const s3Client = new S3Client({
  region: config.region,
  endpoint: config.awsEndpointUrl,
  forcePathStyle: Boolean(config.awsEndpointUrl),
});

export class S3FetchError extends Error {
  constructor(message, { statusCode, code, key, bucket } = {}) {
    super(message);
    this.name = "S3FetchError";
    this.statusCode = statusCode;
    this.code = code;
    this.key = key;
    this.bucket = bucket;
  }

  get isPermanent() {
    return this.statusCode === 404 || this.statusCode === 403;
  }

  get isParseError() {
    return this.code === "PARSE_ERROR";
  }
}

export const buildS3Key = (grantCode, version) => {
  return `${grantCode}/${version}/grant-definition.json`;
};

export const fetchConfigFile = async (bucket, key) => {
  logger.info(`Fetching config from S3: ${bucket}/${key}`);

  let response;
  try {
    response = await s3Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
  } catch (err) {
    const statusCode = err.$metadata?.httpStatusCode;

    if (statusCode === 404 || err.name === "NoSuchKey") {
      throw new S3FetchError(`S3 object not found: ${key}`, {
        statusCode: 404,
        code: "NoSuchKey",
        key,
        bucket,
      });
    }

    if (statusCode === 403 || err.name === "AccessDenied") {
      throw new S3FetchError(`S3 access denied: ${key}`, {
        statusCode: 403,
        code: "AccessDenied",
        key,
        bucket,
      });
    }

    throw new S3FetchError(`S3 service error fetching ${key}: ${err.message}`, {
      statusCode: statusCode || 500,
      code: "SERVICE_ERROR",
      key,
      bucket,
    });
  }

  const bodyString = await response.Body.transformToString();

  try {
    return JSON.parse(bodyString);
  } catch {
    throw new S3FetchError(`Invalid JSON in S3 object: ${key}`, {
      statusCode: 200,
      code: "PARSE_ERROR",
      key,
      bucket,
    });
  }
};
