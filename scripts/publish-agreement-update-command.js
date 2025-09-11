import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

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
  "http://sqs.eu-west-2.127.0.0.1:4566/000000000000/gas__sqs__update_agreement_status";

const message = {
  id: "event-id-300",
  time: "2025-09-09T11:30:52.000Z",
  source: "urn:service:agreement",
  specversion: "1.0",
  type: "io.onsite.agreement.offer.accepted",
  datacontenttype: "application/json",
  data: {
    clientRef: "APPLICATION-PMF-001",
    code: "pigs-might-fly",
    agreementStatus: "OFFER_ACCEPTED",
    agreementRef: "AGREEMENT-REF-123",
    createdAt: "2025-09-09T11:30:52.000Z",
  },
};

console.log("Sending message to SQS queue:", queueUrl);

// customise clientRef
if (process.argv.length === 4) {
  console.log(
    "Sending sqs case for " + process.argv[2] + " " + process.argv[3],
  );
  message.data.clientRef = process.argv[2];
  message.data.code = process.argv[3];
}

await sqs.send(
  new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(message),
    DelaySeconds: 0,
  }),
);

console.log("Message sent");
