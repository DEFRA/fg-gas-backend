import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";

// A Joi message can quote the value it refused, a ref or an operator's name
// among them; its path and type never do.
export const describeDetails = (error) =>
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

// An answer checked as a response schema checks one, for a route that may
// also answer a stream, which hapi checks no response of.
export const checkedResponse = (check, label) => async (answer) => {
  try {
    return await check(answer);
  } catch (error) {
    return safeResponseFailAction(label)(null, null, error);
  }
};
