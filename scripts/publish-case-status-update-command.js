import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

/**
 *  call npm run publish:case:status:update to publish case status update command
 *  you can add your own clientRef and workflow code npm run publish:case:agreement <CLIENT_REF> <WORKFLOW_CODE>
 *  optionally add the currentStatus as the third arg (in lowercase) as APPROVED
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
  "http://sqs.eu-west-2.127.0.0.1:4566/000000000000/gas__sqs__update_status";

const message = {
  id: "event-id-300",
  time: "2025-09-09T11:30:52.000Z",
  source: "urn:service:agreement",
  specversion: "1.0",
  type: "io.onsite.agreement.offer.offered",
  datacontenttype: "application/json",
  data: {
    caseRef: "APPLICATION-PMF-001",
    workflowCode: "pigs-might-fly",
    currentStatus: "APPROVED",
  },
};

console.log("Sending message to SQS queue:", queueUrl);
console.log(process.argv);

if (process.argv.length > 3) {
  console.log(
    "Setting clientRef and workflowCode to " +
      process.argv[2] +
      " " +
      process.argv[3],
  );
  message.data.caseRef = process.argv[2];
  message.data.workflowCode = process.argv[3];
}
if (process.argv.length > 4) {
  const currentStatus = process.argv[4];
  console.log("Setting current status to " + currentStatus);
  message.data.currentStatus = currentStatus;
}

await sqs.send(
  new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(message),
    DelaySeconds: 0,
  }),
);

console.log("Message sent");
