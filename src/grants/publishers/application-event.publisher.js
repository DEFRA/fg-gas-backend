import { config } from "../../common/config.js";
import { publish } from "../../common/sns-client.js";
import { ApplicationApprovedEvent } from "../events/application-approved.event.js";
import { ApplicationCreatedEvent } from "../events/application-created.event.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { ApplicationUpdateStatusCommand } from "../events/application-update-status.command.js";

export const publishApplicationCreated = async (application) => {
  const event = new ApplicationCreatedEvent(application);
  await publish(config.applicationCreatedTopic, event);
};

export const publishApplicationApproved = async (application) => {
  const event = new ApplicationApprovedEvent(application);
  await publish(config.applicationApprovedTopic, event);
};

export const publishApplicationStatusUpdated = async (application) => {
  const event = new ApplicationStatusUpdatedEvent(application);
  await publish(config.sns.grantApplicationStatusUpdatedTopicArn, event);
};

export const publishUpdateApplicationStatusCommand = async ({
  clientRef,
  code,
  agreementData
}) => {
  const event = new ApplicationUpdateStatusCommand({
    clientRef,
    code,
    agreementData,
  });
  await publish(config.sns.updateCaseStatusTopicArn, event);
};
