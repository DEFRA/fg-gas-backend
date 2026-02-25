import Boom from "@hapi/boom";
import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020.js";

import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import { CreateNewCaseCommand } from "../commands/create-new-case.command.js";
import { ApplicationCreatedEvent } from "../events/application-created.event.js";
import { ApplicationXRef } from "../models/application-x-ref.js";
import { Application } from "../models/application.js";
import { Outbox } from "../models/outbox.js";
import { save as saveXref } from "../repositories/application-x-ref.repository.js";
import { save } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
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
  logger.info(`Application submitted for code ${code}`);

  return withTransaction(async (session) => {
    const grant = await findGrantByCodeUseCase(code);

    const { phase, stage, status } = grant.getInitialState();

    const { clientRef, submittedAt, sbi, frn, crn, ...extraMetadata } =
      metadata;

    const application = Application.new({
      currentPhase: phase.code,
      currentStage: stage.code,
      currentStatus: status.code,
      code,
      clientRef,
      submittedAt,
      replacementAllowed: false,
      identifiers: {
        sbi,
        frn,
        crn,
      },
      metadata: extraMetadata,
      phases: [
        {
          code: phase.code,
          answers: getAnswersInSchema(clientRef, phase.questions, answers),
        },
      ],
    });

    const { insertedId: applicationID } = await save(application, session);

    const xref = ApplicationXRef.new({
      clientRefs: [clientRef],
      currentClientId: applicationID,
    });

    await saveXref(xref, session);

    logger.info(
      `Received application "${application.clientRef}" for grant "${application.code}"`,
    );

    const applicationCreatedEvent = new ApplicationCreatedEvent({
      clientRef: application.clientRef,
      code: application.code,
      status: application.getFullyQualifiedStatus(),
    });

    const createNewCaseCommand = new CreateNewCaseCommand(application);

    await insertMany(
      [
        new Outbox({
          event: applicationCreatedEvent,
          target: config.sns.grantApplicationCreatedTopicArn,
          segregationRef: Outbox.getSegregationRef(applicationCreatedEvent),
        }),
        new Outbox({
          event: createNewCaseCommand,
          target: config.sns.createNewCaseTopicArn,
          segregationRef: Outbox.getSegregationRef(createNewCaseCommand),
        }),
      ],
      session,
    );

    logger.info(`Finished: Application submitted for code ${code}`);
  });
};
