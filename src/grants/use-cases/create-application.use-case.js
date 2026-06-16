import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { CreateNewCaseCommand } from "../commands/create-new-case.command.js";
import { ApplicationCreatedEvent } from "../events/application-created.event.js";
import { Application } from "../models/application.js";
import { Outbox } from "../models/outbox.js";
import { save } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { validateAnswersAgainstSchema } from "../services/schema-validation.service.js";
import { findGrantByCodeUseCase } from "./find-grant-by-code.use-case.js";

export const createApplicationUseCase = async (
  code,
  { metadata, answers },
  session,
) => {
  logger.info(`Create application with clientRef ${metadata.clientRef}`);

  const grant = await findGrantByCodeUseCase(code);

  const { phase, stage, status } = grant.getInitialState();

  const { clientRef, submittedAt, sbi, frn, crn, ...extraMetadata } = metadata;

  const application = Application.new({
    currentPhase: phase.code,
    currentStage: stage.code,
    currentStatus: status.code,
    code,
    clientRef,
    submittedAt,
    identifiers: {
      sbi,
      frn,
      crn,
    },
    metadata: extraMetadata,
    phases: [
      {
        code: phase.code,
        answers: validateAnswersAgainstSchema(
          clientRef,
          phase.questions,
          answers,
        ),
      },
    ],
  });

  const { insertedId: applicationID } = await save(application, session);

  logger.info(
    `Created application "${application.clientRef}" for grant "${application.code}"`,
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

  logger.info("End create application.");
  return applicationID.toString();
};
