import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

/**
 *  call npm run publish:case:agreement to publish agreement command
 *  you can add your own clientRef and workflow code npm run publish:case:agreement <CLIENT_REF> <WORKFLOW_CODE>
 *  optionally add the status as the third arg (in lowercase) as created, withdrawn, accepted
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
  "http://sqs.eu-west-2.127.0.0.1:4566/000000000000/gas__sqs__update_agreement_status";

const message = {
  id: "event-id-300",
  time: "2025-09-09T11:30:52.000Z",
  source: "urn:service:agreement",
  specversion: "1.0",
  type: "io.onsite.agreement.offer.offered",
  datacontenttype: "application/json",
  data: {
    clientRef: "APPLICATION-PMF-001",
    code: "pigs-might-fly",
    status: "created", // lower case from agreements-service
    agreementNumber: "AGREEMENT-REF-123",
    date: "2025-09-09T11:30:52.000Z",
    correlationId: "test-correlation-id",
  },
};

console.log("Sending message to SQS queue:", queueUrl);
console.log(process.argv);

if (process.argv.length > 3) {
  console.log(
    "Setting clientRef and code to " + process.argv[2] + " " + process.argv[3],
  );
  message.data.clientRef = process.argv[2];
  message.data.code = process.argv[3];
}

if (process.argv.length > 4) {
  const status = process.argv[4];
  console.log("Setting status to " + status);
  message.data.status = status;
}

await sqs.send(
  new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(message),
    DelaySeconds: 0,
  }),
);

console.log("Message sent");
