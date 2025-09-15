import { config } from "../../common/config.js";
import { publish } from "../../common/sns-client.js";
import { CreateAgreementCommand } from "../events/agreement-created.event.js";
import { ApplicationApprovedEvent } from "../events/application-approved.event.js";
import { ApplicationCreatedEvent } from "../events/application-created.event.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { ApplicationUpdateStatusCommand } from "../events/application-update-status.command.js";

export const publishApplicationCreated = async (application) => {
  const event = new ApplicationCreatedEvent(application);
  await publish(config.applicationCreatedTopic, event);
};

export const publishApplicationApprovedEvent = async (applicationApproved) => {
  const event = new ApplicationApprovedEvent(applicationApproved);
  await publish(config.sns.grantApplicationStatusUpdatedTopicArn, event);
};

export const publishCreateAgreementCommand = async (application) => {
  const event = new CreateAgreementCommand(application);
  await publish(config.sns.createAgreementTopicArn, event);
};

export const publishApplicationStatusUpdated = async (application) => {
  const event = new ApplicationStatusUpdatedEvent(application);
  await publish(config.sns.grantApplicationStatusUpdatedTopicArn, event);
};

export const publishUpdateApplicationStatusCommand = async ({
  newStatus,
  clientRef,
  code,
  agreementData,
}) => {
  const event = new ApplicationUpdateStatusCommand({
    newStatus,
    clientRef,
    code,
    agreementData,
  });
  await publish(config.sns.updateCaseStatusTopicArn, event);
};
