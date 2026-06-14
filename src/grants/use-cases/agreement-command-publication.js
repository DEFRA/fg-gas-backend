import { config } from "../../common/config.js";
import { CreateAgreementCommand } from "../events/create-agreement.command.js";
import { UpdateAgreementStatusCommand } from "../events/update-agreement-status.command.js";
import { Outbox } from "../models/outbox.js";

const createOutboxPublication = ({ event, target }) =>
  new Outbox({
    event,
    target,
    segregationRef: Outbox.getSegregationRef(event),
  });

export const createAgreementCommandPublication = (application) => {
  const event = new CreateAgreementCommand(application);

  return createOutboxPublication({
    event,
    target: config.sns.createAgreementTopicArn,
  });
};

export const updateAgreementStatusCommandPublication = (command) => {
  const event = new UpdateAgreementStatusCommand(command);

  return createOutboxPublication({
    event,
    target: config.sns.updateAgreementStatusTopicArn,
  });
};
