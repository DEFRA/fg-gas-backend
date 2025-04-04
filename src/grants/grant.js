import Boom from "@hapi/boom";
import * as schemas from "./schemas.js";

export const create = (props) => {
  const { error } = schemas.Grant.validate(props);

  if (error) {
    throw Boom.badRequest(error);
  }

  return {
    code: props.code,
    metadata: {
      description: props.metadata.description,
      startDate: props.metadata.startDate,
    },
    actions: props.actions.map((e) => ({
      name: e.name,
      method: e.method,
      url: e.url,
    })),
    questions: props.questions,
  };
};

export const validateCode = (code) => {
  const { error } = schemas.grantCode.validate(code);

  if (error) {
    throw Boom.badRequest(error);
  }
};

export const validateActionName = (name) => {
  const { error } = schemas.actionName.validate(name);

  if (error) {
    throw Boom.badRequest(error);
  }
};

export const validateActionPayload = (payload) => {
  const { error } = schemas.actionPayload.validate(payload);

  if (error) {
    throw Boom.badRequest(error);
  }
};
