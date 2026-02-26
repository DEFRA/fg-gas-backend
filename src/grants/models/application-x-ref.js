import Boom from "@hapi/boom";
import Joi from "joi";

export class ApplicationXRef {
  static validationSchema = Joi.object({
    clientRefs: Joi.array().items(Joi.string()).required(),
    currentClientId: Joi.string().required(),
    currentClientRef: Joi.string().required(),
  });

  constructor(props) {
    const { error } = ApplicationXRef.validationSchema.validate(props, {
      stripUnknown: true,
      abortEarly: false,
    });

    if (error) {
      throw Boom.badRequest(
        `Invalid ApplicationXRef: ${error.details.map((d) => d.message).join(", ")}`,
      );
    }

    this._id = props._id;
    this.clientRefs = new Set(props.clientRefs);
    this.currentClientRef = props.currentClientRef;
    this.currentClientId = props.currentClientId;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  addClientRef(clientRef, clientId) {
    if (!clientRef) {
      throw Boom.badData(
        "Application X Ref can not be updated, clientRef is missing.",
      );
    }

    if (!clientId) {
      throw Boom.badData(
        "Application X Ref can not be updated, clientId is missing.",
      );
    }

    this.clientRefs.add(clientRef);
    this.currentClientId = clientId;
    this.currentClientRef = clientRef;
    this.updatedAt = new Date(Date.now()).toISOString();
  }

  static new({ currentClientId, currentClientRef }) {
    const date = new Date(Date.now()).toISOString();
    return new ApplicationXRef({
      clientRefs: [currentClientRef],
      currentClientRef,
      currentClientId,
      createdAt: date,
      updatedAt: date,
    });
  }

  static fromDocument({
    clientRefs,
    _id,
    currentClientId,
    currentClientRef,
    createdAt,
    updatedAt,
  }) {
    return new ApplicationXRef({
      _id,
      clientRefs,
      currentClientId,
      currentClientRef,
      createdAt,
      updatedAt,
    });
  }

  toDocument() {
    return {
      _id: this._id,
      clientRefs: Array.from(this.clientRefs),
      currentClientRef: this.currentClientRef,
      currentClientId: this.currentClientId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
