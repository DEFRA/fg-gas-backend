import Boom from "@hapi/boom";
import Joi from "joi";

export const FetchStatus = {
  Pending: "pending",
  Fetched: "fetched",
  TransientError: "transient_error",
  PermanentError: "permanent_error",
};

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)$/;
const RADIX = 10;

export const parseSemver = (version) => {
  const match = version.match(SEMVER_REGEX);
  if (!match) {
    return null;
  }
  return {
    major: Number.parseInt(match[1], RADIX),
    minor: Number.parseInt(match[2], RADIX),
    patch: Number.parseInt(match[3], RADIX),
  };
};

export class ConfigVersion {
  static validationSchema = Joi.object({
    grantCode: Joi.string().required(),
    version: Joi.string().required(),
    s3Key: Joi.string().required(),
    s3Bucket: Joi.string().required(),
  });

  // eslint-disable-next-line complexity
  constructor(props) {
    const { error } = ConfigVersion.validationSchema.validate(props, {
      stripUnknown: true,
      abortEarly: false,
    });

    if (error) {
      throw Boom.badRequest(
        `Invalid ConfigVersion: ${error.details.map((d) => d.message).join(", ")}`,
      );
    }

    this._id = props._id;
    this.grantCode = props.grantCode;
    this.version = props.version;
    this.major = props.major;
    this.minor = props.minor;
    this.patch = props.patch;
    this.status = props.status;
    this.s3Key = props.s3Key;
    this.s3Bucket = props.s3Bucket;
    this.receivedAt = props.receivedAt ?? new Date().toISOString();
    this.fetchedAt = props.fetchedAt ?? null;
    this.fetchStatus = props.fetchStatus ?? FetchStatus.Pending;
    this.fetchError = props.fetchError ?? null;
    this.fetchAttempts = props.fetchAttempts ?? 0;
    this.lastFetchAttemptAt = props.lastFetchAttemptAt ?? null;
  }

  static new({ grantCode, version, status, s3Key, s3Bucket }) {
    const parsed = parseSemver(version);
    if (!parsed) {
      throw Boom.badRequest(`Invalid semver version: ${version}`);
    }

    return new ConfigVersion({
      grantCode,
      version,
      major: parsed.major,
      minor: parsed.minor,
      patch: parsed.patch,
      status,
      s3Key,
      s3Bucket,
    });
  }

  static fromDocument(doc) {
    if (!doc) {
      return null;
    }
    return new ConfigVersion(doc);
  }

  toDocument() {
    return {
      grantCode: this.grantCode,
      version: this.version,
      major: this.major,
      minor: this.minor,
      patch: this.patch,
      status: this.status,
      s3Key: this.s3Key,
      s3Bucket: this.s3Bucket,
      receivedAt: this.receivedAt,
      fetchedAt: this.fetchedAt,
      fetchStatus: this.fetchStatus,
      fetchError: this.fetchError,
      fetchAttempts: this.fetchAttempts,
      lastFetchAttemptAt: this.lastFetchAttemptAt,
    };
  }

  static createMock(obj) {
    return new ConfigVersion({
      grantCode: "pigs-might-fly",
      version: "1.0.0",
      major: 1,
      minor: 0,
      patch: 0,
      status: "active",
      s3Key: "pigs-might-fly/1.0.0/grant-definition.json",
      s3Bucket: "config-broker-local",
      receivedAt: new Date().toISOString(),
      fetchStatus: FetchStatus.Pending,
      fetchAttempts: 0,
      ...obj,
    });
  }
}
