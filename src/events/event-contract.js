import Boom from "@hapi/boom";

export const validateEventProps = (schema, props, name) => {
  const { error, value } = schema.validate(props, {
    abortEarly: false,
    allowUnknown: false,
    convert: false,
  });

  if (error) {
    throw Boom.badRequest(
      `Invalid ${name}: ${error.details.map((detail) => detail.message).join(", ")}`,
    );
  }

  return value;
};

export const deepFreeze = (value) => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }

  return value;
};
