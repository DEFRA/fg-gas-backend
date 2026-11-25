import Boom from "@hapi/boom";

const HTTP_INTERNAL_ERROR = 500;

// A grant definition that cannot be built into a Grant. Grant and
// EntitlementTemplate validation throws Boom.badImplementation, but a definition
// that is malformed rather than merely invalid - no metadata key,
// entitlementTemplates published as an object - dies on a plain TypeError
// instead. Anything else, such as a Mongo failure, is transient.
export const isDefinitionDefect = (err) =>
  (err.isBoom && err.output.statusCode === HTTP_INTERNAL_ERROR) ||
  err instanceof TypeError;

// The config broker also publishes a grant's release under each of its
// aliases, all pointing at the same definition. A definition is stored under
// its own code, so a version published under any other code can never be read
// back as a grant of that code: it is a defect of that version.
export const assertForGrant = (definition, grantCode) => {
  if (definition.code !== grantCode) {
    throw Boom.badImplementation(
      `Definition is for "${definition.code}", not "${grantCode}"`,
    );
  }
};
