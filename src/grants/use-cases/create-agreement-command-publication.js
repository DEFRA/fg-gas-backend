import { config } from "../../common/config.js";
import { CreateAgreementCommand } from "../events/create-agreement.command.js";
import { Outbox } from "../models/outbox.js";

export const createAgreementCommandPublication = (application) => {
  const createAgreementCommand = new CreateAgreementCommand(application);

  return new Outbox({
    event: createAgreementCommand,
    target: config.sns.createAgreementTopicArn,
    segregationRef: Outbox.getSegregationRef(createAgreementCommand),
  });
};
