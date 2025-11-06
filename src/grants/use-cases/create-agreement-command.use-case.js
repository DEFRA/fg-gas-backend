import { config } from "../../common/config.js";
import { CreateAgreementCommand } from "../events/create-agreement.command.js";
import { Outbox } from "../models/outbox.js";
import { insertMany } from "../repositories/outbox.repository.js";

export const createAgreementCommandUseCase = async (
  { application },
  session,
) => {
  const createAgreementCommand = new CreateAgreementCommand(application);
  await insertMany(
    [
      new Outbox({
        event: createAgreementCommand,
        target: config.sns.createAgreementTopicArn,
      }),
    ],
    session,
  );
};
