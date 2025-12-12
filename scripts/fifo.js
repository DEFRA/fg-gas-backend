import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { randomUUID } from "node:crypto";
import { env } from "process";

const sqs = new SQSClient({
  region: env.AWS_REGION || "eu-west-2",
  endpoint: env.AWS_ENDPOINT_URL || "http://localhost:4566",
  credentials: {
    accessKeyId: "test",
    secretAccessKey: "test",
  },
});

export const sendMessage = async (message, delay, url) => {
  console.log("sending message ", url, message);
  return await sqs.send(
    new SendMessageCommand({
      QueueUrl: url,
      MessageBody: JSON.stringify(message),
      //      MessageGroupId: "julian-test-007",
      //      MessageDeduplicationId: message.id,
      DelaySeconds: delay,
    }),
  );
};

const messages = [
  {
    source: "CW",
    specversion: "1.0",
    datacontenttype: "application/json",
    time: new Date(Date.now()).toISOString(),
    traceparent: "trace-123",
    type: "cloud.defra.local.fg-cw-backend.case.status.updated",
    id: randomUUID(),
    data: {
      caseRef: "julian-test-007",
      workflowCode: "frps-private-beta",
      currentStatus: "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
    },
  },
  {
    source: "CW",
    specversion: "1.0",
    datacontenttype: "application/json",
    time: new Date(Date.now() + 1).toISOString(),
    traceparent: "trace-123",
    type: "cloud.defra.local.fg-cw-backend.case.status.updated",
    id: randomUUID(),
    data: {
      caseRef: "julian-test-007",
      workflowCode: "frps-private-beta",
      currentStatus: "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING",
    },
  },
  {
    source: "AS",
    specversion: "1.0",
    datacontenttype: "application/json",
    time: new Date(Date.now() + 3).toISOString(),
    traceparent: "trace-123",
    type: "cloud.defra.local.fg-cw-backend.case.status.updated",
    id: randomUUID(),
    data: {
      clientRef: "julian-test-007",
      code: "frps-private-beta",
      status: "offered",
      agreementNumber: "agreement-123",
      date: new Date(Date.now()).toISOString(),
    },
  },
  {
    source: "CW",
    specversion: "1.0",
    datacontenttype: "application/json",
    time: new Date(Date.now() + 4).toISOString(),
    traceparent: "trace-123",
    type: "cloud.defra.local.fg-cw-backend.case.status.updated",
    id: randomUUID(),
    data: {
      caseRef: "julian-test-007",
      workflowCode: "frps-private-beta",
      currentStatus: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
    },
  },
  {
    source: "AS",
    specversion: "1.0",
    datacontenttype: "application/json",
    time: new Date(Date.now() + 5).toISOString(),
    traceparent: "trace-123",
    type: "cloud.defra.local.fg-cw-backend.case.status.updated",
    id: randomUUID(),
    data: {
      clientRef: "julian-test-007",
      code: "frps-private-beta",
      status: "withdrawn",
      agreementNumber: "agreement-123",
    },
  },
];

const urls = [
  env.GAS__SQS__UPDATE_STATUS_QUEUE_URL,
  env.GAS__SQS__UPDATE_STATUS_QUEUE_URL,
  env.GAS__SQS__UPDATE_AGREEMENT_STATUS_QUEUE_URL,
  env.GAS__SQS__UPDATE_STATUS_QUEUE_URL,
  env.GAS__SQS__UPDATE_AGREEMENT_STATUS_QUEUE_URL,
];

// this (hopefully) means the events will arrive out of order
const times = [0, 1, 2, 7, 3];

const queueMessages = async () => {
  let i = 0;
  for await (const msg of messages) {
    await sendMessage(msg, times[i], urls[i]);
    i++;
  }
};

queueMessages();
