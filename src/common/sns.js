import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { config } from "./config.js";

export const snsClient = new SNSClient({
  region: config.region,
  endpoint: config.awsEndointUrl,
});

/**
 *
 * @param {string} topicArn
 * @param {JSON} message
 * @returns
 */
export const publish = async (topicArn, message) => {
  return snsClient.send(
    new PublishCommand({
      Message: JSON.stringify(message),
      TopicArn: topicArn,
    }),
  );
};
