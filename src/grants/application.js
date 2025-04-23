import Boom from "@hapi/boom";
import Ajv2020 from "ajv/dist/2020.js";

export const createApplication = (code, schema, data) => {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    removeAdditional: "all",
    useDefaults: true,
  });

  // Ajv mutates original
  const answers = structuredClone(data.answers);

  const valid = ajv.validate(schema, answers);

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
