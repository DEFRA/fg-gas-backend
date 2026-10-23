import Boom from "@hapi/boom";
import Joi from "joi";
import { FetchStatus } from "../../common/fetch-status.js";
import { version } from "../schemas/grant/version.js";
import { ConfigVersionStatus } from "./config-version.js";

const FILE_TYPES = ["grant", "agreement", "payment"];

const fetchStatus = Joi.string().valid(...Object.values(FetchStatus));

const fileSchema = Joi.object({
  stored: Joi.boolean().required(),
  fetchStatus: fetchStatus.required(),
  fetchError: Joi.string().allow(null).required(),
  fetchAttempts: Joi.number().integer().min(0).required(),
  s3Key: Joi.string().allow(null).required(),
});

// A Config Version as the admin sees it: each of its Definition Files, and
// whether GAS has stored it.
export class ConfigVersionFiles {
  static validationSchema = Joi.object({
    grantCode: Joi.string().required(),
    version: version.required(),
    status: Joi.string()
      .valid(...Object.values(ConfigVersionStatus))
      .required(),
    receivedAt: Joi.string().isoDate().required(),
    s3Bucket: Joi.string().allow(null).required(),
    // Null until the version is stamped with one.
    worstFetchStatus: fetchStatus.allow(null).required(),
    files: Joi.object({
      grant: fileSchema.required(),
      agreement: fileSchema,
      payment: fileSchema,
    }).required(),
  });

  constructor(props) {
    const { error } = ConfigVersionFiles.validationSchema.validate(props, {
      abortEarly: false,
    });

    if (error) {
      throw Boom.badImplementation(
        `Invalid ConfigVersionFiles: ${error.details.map((d) => d.message).join(", ")}`,
      );
    }

    this.grantCode = props.grantCode;
    this.version = props.version;
    this.status = props.status;
    this.receivedAt = props.receivedAt;
    this.s3Bucket = props.s3Bucket;
    this.worstFetchStatus = props.worstFetchStatus;
    this.files = props.files;
  }

  static typesIn(doc) {
    return FILE_TYPES.filter((type) => doc.definitions?.[type]);
  }

  missingFiles() {
    return FILE_TYPES.filter((type) => this.files[type]?.stored === false);
  }

  allStored() {
    return this.missingFiles().length === 0;
  }

  static fromDocument(doc, storedTypes) {
    const files = Object.fromEntries(
      ConfigVersionFiles.typesIn(doc).map((type) => [
        type,
        {
          stored: storedTypes.has(type),
          fetchStatus: doc.definitions[type].fetchStatus,
          fetchError: doc.definitions[type].fetchError,
          fetchAttempts: doc.definitions[type].fetchAttempts,
          s3Key: doc.definitions[type].s3Key,
        },
      ]),
    );

    return new ConfigVersionFiles({
      grantCode: doc.grantCode,
      version: doc.version,
      status: doc.status,
      receivedAt: doc.receivedAt,
      s3Bucket: doc.s3Bucket,
      worstFetchStatus: doc.worstFetchStatus ?? null,
      files,
    });
  }

  toView() {
    return {
      code: this.grantCode,
      version: this.version,
      status: this.status,
      receivedAt: this.receivedAt,
      s3Bucket: this.s3Bucket,
      files: this.files,
    };
  }
}
