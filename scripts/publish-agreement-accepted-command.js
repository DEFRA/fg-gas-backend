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
    correlationId: "d6898dc9-124b-4ba8-b38e-b0d759a95652",
    clientRef: "APPLICATION-PMF-001",
    version: 1,
    agreementUrl:
      "https://farming-grants-agreements-ui.dev.cdp-int.defra.cloud/AGREEMENT-REF-123",
    status: "accepted",
    code: "pigs-might-fly",
    agreementCreateDate: "2026-02-16T10:15:28.542Z",
    agreementAcceptedDate: "2026-02-16T10:22:58.438Z",
    agreementStartDate: "2026-03-01",
    agreementEndDate: "2027-02-28",
    claimId: "R00000017",
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
