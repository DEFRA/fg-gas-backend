import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";

// A Joi message can quote the value it refused, a ref or an operator's name
// among them; its path and type never do.
const describeDetails = (error) =>
  (error?.details ?? [])
    .map(({ path, type }) => `${path.join(".")}:${type}`)
    .join(", ");

export const safeFailAction = (label) => (_request, _h, error) => {
  const details = describeDetails(error);

  logger.warn(`${label} request refused: ${details}`);

  throw Boom.badRequest(`Invalid request: ${details}`);
};

export const safeResponseFailAction = (label) => (_request, _h, error) => {
  logger.error(
    `${label} response failed validation: ${describeDetails(error)}`,
  );

  throw Boom.badImplementation(`${label} response failed validation`);
};
