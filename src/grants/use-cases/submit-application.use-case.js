import Boom from "@hapi/boom";
import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020.js";

import { Application } from "../models/application.ts";
import { publishApplicationCreated } from "../publishers/application-event.publisher.js";
import { publishCreateNewCase } from "../publishers/case-event.publisher.js";
import { save } from "../repositories/application.repository.js";
import { findGrantByCodeUseCase } from "./find-grant-by-code.use-case.js";

const getAnswersInSchema = (clientRef, schema, answers) => {
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
    validate: function (schema, data) {
      const fields = schema.fields;
      const targetField = schema.targetField;
      const sum = fields.reduce((acc, field) => acc + (data[field] || 0), 0);
      return sum === data[targetField];
    },
    error: {
      message: (cxt) => {
        const { schema } = cxt;
        return `fgSumEquals validation failed: sum of fields ${schema.fields.join(", ")} must equal ${schema.targetField}`;
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

export const submitApplicationUseCase = async (code, { metadata, answers }) => {
  const grant = await findGrantByCodeUseCase(code);

  const application = Application.new({
    code,
    clientRef: metadata.clientRef,
    submittedAt: metadata.submittedAt,
    identifiers: {
      sbi: metadata.sbi,
      frn: metadata.frn,
      crn: metadata.crn,
      defraId: metadata.defraId,
    },
    answers: getAnswersInSchema(metadata.clientRef, grant.questions, answers),
  });

  await save(application);

  await publishApplicationCreated({
    clientRef: application.clientRef,
    code: application.code,
    status: application.getFullyQualifiedStatus(),
  });

  await publishCreateNewCase(application);
};
