import Boom from "@hapi/boom";
import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020.js";

export const validateAnswersAgainstSchema = (clientRef, schema, answers) => {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    useDefaults: true,
    verbose: true,
    removeAdditional: true,
  });

  // Custom keyword to check sum of fields equals a target field exactly
  ajv.addKeyword({
    keyword: "fgSumEquals",
    type: "object",
    schemaType: "object",
    validate: function (keywordSchema, data) {
      const fields = keywordSchema.fields;
      const targetField = keywordSchema.targetField;
      const sum = fields.reduce((acc, field) => acc + (data[field] || 0), 0);
      return Math.abs(sum - data[targetField]) < Number.EPSILON;
    },
    error: {
      message: (cxt) => {
        const { schema: keywordSchema } = cxt;
        return `fgSumEquals validation failed: sum of fields ${keywordSchema.fields.join(", ")} must equal ${keywordSchema.targetField}`;
      },
    },
  });

  // Custom keyword to check sum of fields is less than or equal to a target field
  ajv.addKeyword({
    keyword: "fgSumMax",
    type: "object",
    schemaType: "object",
    validate: function (keywordSchema, data) {
      const fields = keywordSchema.fields;
      const targetField = keywordSchema.targetField;
      const sum = fields.reduce((acc, field) => acc + (data[field] || 0), 0);
      return sum <= data[targetField];
    },
    error: {
      message: (cxt) => {
        const { schema: keywordSchema } = cxt;
        return `fgSumMax validation failed: sum of fields ${keywordSchema.fields.join(", ")} must be less than or equal to ${keywordSchema.targetField}`;
      },
    },
  });

  // Ajv strips unknown fields and mutates the original
  const clonedAnswers = structuredClone(answers);

  addFormats(ajv, ["date-time", "date", "time", "duration", "email", "uri"]);

  let valid;
  try {
    valid = ajv.validate(schema, clonedAnswers);
  } catch (error) {
    throw Boom.badRequest(
      `Application with clientRef "${clientRef}" cannot be validated: ${error.message}`,
    );
  }

  if (!valid) {
    const errors = ajv.errorsText().replaceAll("data/", "");
    throw Boom.badRequest(
      `Application with clientRef "${clientRef}" has invalid answers: ${errors}`,
    );
  }

  return clonedAnswers;
};
