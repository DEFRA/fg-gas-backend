import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { config } from "./config.js";

export const snsClient = new SNSClient({
  region: config.region,
  endpoint: config.awsEndointUrl,
});

export const publish = (message, topicArn) => {
  return snsClient.send(
    new PublishCommand({ Message: message, TopicArn: topicArn }),
  );
};
