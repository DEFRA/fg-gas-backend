import Boom from "@hapi/boom";
import { agreementDefinitionSchema } from "../../schemas/agreement-definition.schema.js";

export const validateAgreementDefinition = (definition) => {
  const { value, error } = agreementDefinitionSchema.validate(definition, {
    abortEarly: false,
  });

  if (error) {
    // badImplementation (500), not badRequest: an invalid Agreement definition
    // is a server-side configuration defect, never something a caller supplied.
    throw Boom.badImplementation(
      `Invalid agreement definition "${definition?.code}": ${error.details.map((d) => d.message).join(", ")}`,
    );
  }

  return value;
};
