import Boom from "@hapi/boom";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const createApplication = (code, schema, data) => {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    removeAdditional: "all",
    useDefaults: true,
  });
  addFormats(ajv, ["date-time", "date", "time", "duration", "email", "uri"]);

  // Ajv mutates original
  const answers = structuredClone(data.answers);

  let valid;
  try {
    valid = ajv.validate(schema, answers);
  } catch (error) {
    const { clientRef } = data.metadata;
    throw Boom.badRequest(
      `Error occurred when validating application with clientRef "${clientRef}". Error: ${error.message}`,
    );
  }

  if (!valid) {
    const { clientRef } = data.metadata;
    const errors = ajv.errorsText();

    throw Boom.badRequest(
      `Application with clientRef "${clientRef}" has invalid answers: ${errors}`,
    );
  }

  return {
    code,
    createdAt: new Date(),
    clientRef: data.metadata.clientRef,
    submittedAt: data.metadata.submittedAt,
    identifiers: {
      sbi: data.metadata.sbi,
      frn: data.metadata.frn,
      crn: data.metadata.crn,
      defraId: data.metadata.defraId,
    },
    answers,
  };
};
