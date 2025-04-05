import Ajv2020 from "ajv/dist/2020.js";
import Joi from "joi";

export const questions = Joi.object({
  $schema: Joi.string()
    .allow("https://json-schema.org/draft/2020-12/schema")
    .required(),
  type: Joi.string().valid("object").required(),
})
  .unknown(true)
  .label("Questions")
  .custom((schema, helpers) => {
    const ajv2020 = new Ajv2020({
      strict: true,
    });

    try {
      // throws if $schema is not 2020-12
      if (ajv2020.validateSchema(schema)) {
        return schema;
      }

      const [error] = ajv2020.errors;

      const message = [`'${error.instancePath}'`, error.message];

      if (error.params.allowedValues) {
        message.push(error.params.allowedValues.join(", "));
      }

      return helpers.message({
        custom: message.join(" "),
      });
    } catch (error) {
      return helpers.message({
        custom: error.message,
      });
    }
  });
