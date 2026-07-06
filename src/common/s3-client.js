import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "./config.js";
import { logger } from "./logger.js";

const s3Client = new S3Client({
  region: config.region,
  endpoint: config.awsEndpointUrl,
  forcePathStyle: Boolean(config.awsEndpointUrl),
});

const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;
const HTTP_OK = 200;
const HTTP_INTERNAL_ERROR = 500;

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
    return (
      this.statusCode === HTTP_NOT_FOUND || this.statusCode === HTTP_FORBIDDEN
    );
  }

  get isParseError() {
    return this.code === "PARSE_ERROR";
  }
}

export const buildS3Key = (grantCode, version) => {
  return `${grantCode}/${version}/gas/gas.json`;
};

// eslint-disable-next-line complexity
const classifyS3Error = (err, key, bucket) => {
  const statusCode = err.$metadata?.httpStatusCode;

  if (statusCode === HTTP_NOT_FOUND || err.name === "NoSuchKey") {
    return new S3FetchError(`S3 object not found: ${key}`, {
      statusCode: HTTP_NOT_FOUND,
      code: "NoSuchKey",
      key,
      bucket,
    });
  }

  if (statusCode === HTTP_FORBIDDEN || err.name === "AccessDenied") {
    return new S3FetchError(`S3 access denied: ${key}`, {
      statusCode: HTTP_FORBIDDEN,
      code: "AccessDenied",
      key,
      bucket,
    });
  }

  return new S3FetchError(`S3 service error fetching ${key}: ${err.message}`, {
    statusCode: statusCode || HTTP_INTERNAL_ERROR,
    code: "SERVICE_ERROR",
    key,
    bucket,
  });
};

const parseResponseBody = (bodyString, key, bucket) => {
  try {
    return JSON.parse(bodyString);
  } catch {
    throw new S3FetchError(`Invalid JSON in S3 object: ${key}`, {
      statusCode: HTTP_OK,
      code: "PARSE_ERROR",
      key,
      bucket,
    });
  }
};

export const fetchConfigFile = async (bucket, key) => {
  logger.info(`Fetching config from S3: ${bucket}/${key}`);

  let response;
  try {
    response = await s3Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
  } catch (err) {
    throw classifyS3Error(err, key, bucket);
  }

  const bodyString = await response.Body.transformToString();
  return parseResponseBody(bodyString, key, bucket);
};
