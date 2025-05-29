import Boom from "@hapi/boom";
import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020.js";

import { Application } from "../models/application.js";
import { publishApplicationCreated } from "../publishers/application-event.publisher.js";
import { save } from "../repositories/application.repository.js";
import { findGrantByCodeUseCase } from "./find-grant-by-code.use-case.js";

const getAnswersInSchema = (clientRef, schema, answers) => {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    removeAdditional: "all",
    useDefaults: true,
  });

  addFormats(ajv, ["date-time", "date", "time", "duration", "email", "uri"]);

  // Ajv strips unknown fields and mutates the original
  const clonedAnswers = structuredClone(answers);

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

  const application = new Application({
    clientRef: metadata.clientRef,
    code,
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

  await publishApplicationCreated(application);
};
