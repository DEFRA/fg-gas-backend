import Boom from "@hapi/boom";
import { validateProcessMapping } from "../../common/mapping/resolve-process-mapping.js";

// An output Mapping that cannot resolve is a definition fault, refused before
// its version is recorded.
export const assertOutputMappingValid = (owner, output) => {
  try {
    validateProcessMapping(output.items);
  } catch (error) {
    throw Boom.badImplementation(
      `${owner} output items mapping is invalid: ${error.message}`,
    );
  }
};
