import Boom from "@hapi/boom";
import Joi from "joi";

export class ApplicationSeries {
  static validationSchema = Joi.object({
    clientRefs: Joi.array().items(Joi.string()).required(),
    code: Joi.string().required(),
    latestClientId: Joi.string().required(),
    latestClientRef: Joi.string().required(),
    updatedAt: Joi.string().required(),
    createdAt: Joi.string().required(),
  });

  constructor(props) {
    const { error } = ApplicationSeries.validationSchema.validate(props, {
      stripUnknown: true,
      abortEarly: false,
    });

    if (error) {
      throw Boom.badRequest(
        `Invalid ApplicationSeries: ${error.details.map((d) => d.message).join(", ")}`,
      );
    }

    this._id = props._id;
    this.clientRefs = new Set(props.clientRefs);
    this.code = props.code;
    this.latestClientRef = props.latestClientRef;
    this.latestClientId = props.latestClientId;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  addClientRef(clientRef, clientId) {
    if (!clientRef) {
      throw Boom.badData(
        "ApplicationSeries can not be updated, clientRef is missing.",
      );
    }

    if (!clientId) {
      throw Boom.badData(
        "ApplicationSeries can not be updated, clientId is missing.",
      );
    }

    this.clientRefs.add(clientRef);
    this.latestClientId = clientId;
    this.latestClientRef = clientRef;
    this.updatedAt = new Date(Date.now()).toISOString();
  }

  static new({ code, latestClientId, latestClientRef }) {
    const date = new Date(Date.now()).toISOString();
    return new ApplicationSeries({
      clientRefs: [latestClientRef],
      code,
      latestClientRef,
      latestClientId,
      createdAt: date,
      updatedAt: date,
    });
  }

  static fromDocument({
    clientRefs,
    _id,
    code,
    latestClientId,
    latestClientRef,
    createdAt,
    updatedAt,
  }) {
    return new ApplicationSeries({
      _id,
      clientRefs,
      code,
      latestClientId,
      latestClientRef,
      createdAt,
      updatedAt,
    });
  }

  toDocument() {
    return {
      _id: this._id,
      clientRefs: Array.from(this.clientRefs),
      code: this.code,
      latestClientRef: this.latestClientRef,
      latestClientId: this.latestClientId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
