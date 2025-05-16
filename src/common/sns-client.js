import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { config } from "./config.js";

const snsClient = new SNSClient({
  region: config.region,
  endpoint: config.awsEndpointUrl,
});

export const publish = async (topic, data) => {
  await snsClient.send(
    new PublishCommand({
      TopicArn: topic,
      Message: JSON.stringify(data),
    }),
  );
};
