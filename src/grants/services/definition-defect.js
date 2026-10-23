const HTTP_INTERNAL_ERROR = 500;

// A grant definition that cannot be built into a Grant. Grant and
// EntitlementTemplate validation throws Boom.badImplementation, but a definition
// that is malformed rather than merely invalid - no metadata key,
// entitlementTemplates published as an object - dies on a plain TypeError
// instead. Anything else, such as a Mongo failure, is transient.
export const isDefinitionDefect = (err) =>
  (err.isBoom && err.output.statusCode === HTTP_INTERNAL_ERROR) ||
  err instanceof TypeError;
