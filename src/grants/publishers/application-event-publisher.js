import { randomUUID } from "node:crypto";
import config from "../../../config.js";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

export const snsClient = new SNSClient({
  region: config.region,
  endpoint: config.awsEndpointUrl,
});

export const publishApplicationApproved = async (application) => {
  const event = {
    id: randomUUID(),
    source: config.serviceName,
    specVersion: "1.0",
    type: `cloud.defra.${config.env}.${config.serviceName}.application.approved`,
    datacontenttype: "application/json",
    data: application, // TODO: map to event schema
  };

  await snsClient.send(
    new PublishCommand({
      Message: JSON.stringify(event),
      TopicArn: config.grantApplicationApprovedTopic,
    }),
  );
};
