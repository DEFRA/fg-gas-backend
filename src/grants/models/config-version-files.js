import Boom from "@hapi/boom";
import Joi from "joi";
import { FetchStatus } from "../../common/fetch-status.js";
import { version } from "../schemas/grant/version.js";
import { ConfigVersionStatus } from "./config-version.js";

const FILE_TYPES = ["grant", "agreement", "payment"];

const fileSchema = Joi.object({
  stored: Joi.boolean().required(),
  fetchStatus: Joi.string()
    .valid(...Object.values(FetchStatus))
    .required(),
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
    this.files = props.files;
  }

  static typesIn(doc) {
    return FILE_TYPES.filter((type) => doc.definitions?.[type]);
  }

  static fromDocument(doc, storedTypes) {
    const files = Object.fromEntries(
      ConfigVersionFiles.typesIn(doc).map((type) => [
        type,
        {
          stored: storedTypes.has(type),
          fetchStatus: doc.definitions[type].fetchStatus,
        },
      ]),
    );

    return new ConfigVersionFiles({
      grantCode: doc.grantCode,
      version: doc.version,
      status: doc.status,
      receivedAt: doc.receivedAt,
      files,
    });
  }

  toView() {
    return {
      code: this.grantCode,
      version: this.version,
      status: this.status,
      receivedAt: this.receivedAt,
      files: this.files,
    };
  }
}
