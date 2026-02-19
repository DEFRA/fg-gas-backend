import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { randomUUID } from "node:crypto";
/**
 *  call npm run publish:case:agreement to publish agreement command
 *  you can add your own clientRef and workflow code npm run publish:case:agreement <CLIENT_REF> <WORKFLOW_CODE>
 */

const sqs = new SQSClient({
  region: "eu-west-2",
  endpoint: "http://localhost:4566",
  credentials: {
    accessKeyId: "test",
    secretAccessKey: "test",
  },
});

const queueUrl =
  "http://sqs.eu-west-2.127.0.0.1:4566/000000000000/gas__sqs__update_agreement_status_fifo.fifo";

const message = {
  id: randomUUID(),
  time: "2025-09-09T11:30:52.000Z",
  source: "urn:service:agreement",
  specversion: "1.0",
  type: "io.onsite.agreement.status.updated",
  datacontenttype: "application/json",
  data: {
    agreementNumber: "AGREEMENT-REF-123",
    correlationId: "ebfd8259-1c16-4b34-af9b-6ca5ba7a02e9",
    clientRef: "clientcoc0u82x",
    version: 1,
    agreementUrl: "http://localhost:3555/FPTT168352520",
    status: "accepted",
    date: "2026-02-11T23:23:48.655Z",
    code: "frps-private-beta",
    startDate: "2026-03-01",
    endDate: "2027-03-01",
    claimId: "R00000003",
  },
};

console.log("Sending message to SQS queue:", queueUrl);
console.log(process.argv);

if (process.argv.length > 3) {
  console.log(
    "Setting clientRef and code to" + process.argv[2] + " " + process.argv[3],
  );
  message.data.clientRef = process.argv[2];
  message.data.code = process.argv[3];
}

await sqs.send(
  new SendMessageCommand({
    MessageGroupId: randomUUID(),
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(message),
    DelaySeconds: 0,
  }),
);

console.log("Message sent");
