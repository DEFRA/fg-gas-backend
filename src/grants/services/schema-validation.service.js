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
    validate: (keywordSchema, data) => {
      const sum = sumFields(data, keywordSchema.fields);
      const target = data[keywordSchema.targetField];
      return Math.abs(sum - target) < floatTolerance(sum, target);
    },
    error: {
      message: (cxt) => {
        const { schema: keywordSchema } = cxt;
        return `fgSumEquals validation failed: sum of fields ${keywordSchema.fields.join(", ")} must equal ${keywordSchema.targetField}`;
      },
    },
  });

  // Custom keyword to check sum of fields is greater than or equal to a literal minimum
  ajv.addKeyword({
    keyword: "fgSumMin",
    type: "object",
    schemaType: "object",
    validate: (keywordSchema, data) => {
      const sum = sumFields(data, keywordSchema.fields);
      const { minimum } = keywordSchema;
      return sum + floatTolerance(sum, minimum) >= minimum;
    },
    error: {
      message: (cxt) => {
        const { schema: keywordSchema } = cxt;
        return `fgSumMin validation failed: sum of fields ${keywordSchema.fields.join(", ")} must be greater than or equal to ${keywordSchema.minimum}`;
      },
    },
  });

  // Custom keyword to check sum of fields is less than or equal to a target field
  ajv.addKeyword({
    keyword: "fgSumMax",
    type: "object",
    schemaType: "object",
    validate: (keywordSchema, data) => {
      const sum = sumFields(data, keywordSchema.fields);
      const target = data[keywordSchema.targetField];
      return sum <= target + floatTolerance(sum, target);
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

const resolveFieldSum = (data, field) => {
  const arraySep = field.indexOf("[].");
  if (arraySep === -1) {
    return Number(data[field]) || 0;
  }
  const arrayField = field.slice(0, arraySep);
  const itemField = field.slice(arraySep + "[].".length);
  const arr = data[arrayField];
  if (!Array.isArray(arr)) {
    return 0;
  }
  return arr.reduce((acc, item) => acc + (Number(item?.[itemField]) || 0), 0);
};

const sumFields = (data, fields) =>
  fields.reduce((acc, field) => acc + resolveFieldSum(data, field), 0);

// Scaled relative tolerance for comparing floating-point sums.
// Number.EPSILON is the spacing around 1; at larger magnitudes we need to scale it,
// otherwise e.g. 8.5 + 4.2 fails equality with 12.7 even though they're "the same".
const floatTolerance = (...values) =>
  Number.EPSILON * 16 * Math.max(1, ...values.map(Math.abs));
