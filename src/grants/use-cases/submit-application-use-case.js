import Boom from "@hapi/boom";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { Application } from "../models/application.js";
import { add } from "../repositories/application-repository.js";
import { publishApplicationCreated } from "../publishers/application-event-publisher.js";
import { findByCodeUseCase } from "./find-by-code-use-case.js";

const validateAndGetAnswersInSchema = (clientRef, schema, answers) => {
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
      `Error occurred when validating application with clientRef "${clientRef}". Error: ${error.message}`,
    );
  }

  if (!valid) {
    const errors = ajv.errorsText();

    throw Boom.badRequest(
      `Application with clientRef "${clientRef}" has invalid answers: ${errors}`,
    );
  }

  return clonedAnswers;
};

export const submitApplicationUseCase = async (
  code,
  createApplicationRequest,
) => {
  const grant = await findByCodeUseCase(code);

  const { metadata, answers } = createApplicationRequest;

  const application = new Application(
    metadata.clientRef,
    code,
    metadata.submittedAt,
    {
      sbi: metadata.sbi,
      frn: metadata.frn,
      crn: metadata.crn,
      defraId: metadata.defraId,
    },
    validateAndGetAnswersInSchema(metadata.clientRef, grant.questions, answers),
  );

  await add(application);

  await publishApplicationCreated(application);
};
