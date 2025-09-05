import { ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import Wreck from "@hapi/wreck";
import { MongoClient } from "mongodb";
import { env } from "node:process";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

let client;
let grants, applications;
let sqsClient;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  grants = client.db().collection("grants");
  applications = client.db().collection("applications");

  sqsClient = new SQSClient({
    region: env.AWS_REGION,
    endpoint: env.AWS_ENDPOINT_URL,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
});

afterAll(async () => {
  await client?.close();
});

describe("Simple SNS Integration Tests", () => {
  beforeEach(async () => {
    // Clean up test data
    await grants.deleteMany({ code: { $regex: "^test-sns-" } });
    await applications.deleteMany({ clientRef: { $regex: "^test-sns-" } });
  });

  afterEach(async () => {
    // Clean up after each test
    await grants.deleteMany({ code: { $regex: "^test-sns-" } });
    await applications.deleteMany({ clientRef: { $regex: "^test-sns-" } });
  });

  it("should publish SNS event when application is submitted", async () => {
    const testId = Date.now();
    const grantCode = `test-sns-grant-${testId}`;
    const clientRef = `test-sns-app-${testId}`;

    // Create grant
    const grantData = {
      code: grantCode,
      metadata: {
        description: "Test grant for SNS event publishing",
        startDate: "2025-01-01T00:00:00.000Z",
      },
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          farmName: { type: "string" },
          farmSize: { type: "number", minimum: 1 },
          isOrganic: { type: "boolean" },
        },
        required: ["farmName", "farmSize", "isOrganic"],
      },
      actions: [],
    };

    await Wreck.post(`${env.API_URL}/grants`, {
      payload: grantData,
    });

    // Submit application (should trigger SNS event)
    const applicationData = {
      metadata: {
        clientRef,
        submittedAt: new Date().toISOString(),
        sbi: "987654321",
        frn: "123456789",
        crn: "555777999",
        defraId: "DEF987654",
      },
      answers: {
        farmName: "SNS Test Farm",
        farmSize: 200.5,
        isOrganic: true,
      },
    };

    const response = await Wreck.post(
      `${env.API_URL}/grants/${grantCode}/applications`,
      {
        headers: { "x-cdp-request-id": `sns-test-${testId}` },
        payload: applicationData,
      },
    );
    expect(response.res.statusCode).toBe(204);

    // Poll for SNS message
    const snsMessage = await pollForSNSMessage(clientRef, 15000);
    expect(snsMessage, "SNS message should be published").toBeTruthy();

    // Verify event structure
    expect(snsMessage.source).toBe("fg-gas-backend");
    expect(snsMessage.type).toBe(
      "cloud.defra.development.fg-gas-backend.application.created",
    );
    expect(snsMessage.data.clientRef).toBe(clientRef);
    expect(snsMessage.data.code).toBe(grantCode);
    expect(snsMessage.data.answers.farmName).toBe("SNS Test Farm");
    expect(snsMessage.data.answers.farmSize).toBe(200.5);
    expect(snsMessage.data.answers.isOrganic).toBe(true);
    expect(snsMessage.data.identifiers.sbi).toBe("987654321");
    expect(snsMessage.traceparent).toBe(`sns-test-${testId}`);

    console.log("✅ SNS event integration test completed");
  });

  it("should preserve data types in SNS events", async () => {
    const testId = Date.now();
    const grantCode = `test-sns-types-${testId}`;
    const clientRef = `test-sns-types-${testId}`;

    // Create grant
    const grantData = {
      code: grantCode,
      metadata: {
        description: "Test grant for data type preservation",
        startDate: "2025-01-01T00:00:00.000Z",
      },
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          preciseDecimal: { type: "number" },
          largeInteger: { type: "integer" },
          booleanValue: { type: "boolean" },
          stringValue: { type: "string" },
        },
        required: [
          "preciseDecimal",
          "largeInteger",
          "booleanValue",
          "stringValue",
        ],
      },
      actions: [],
    };

    await Wreck.post(`${env.API_URL}/grants`, {
      payload: grantData,
    });

    // Submit application with precise data types
    const applicationData = {
      metadata: {
        clientRef,
        submittedAt: new Date("2025-02-14T14:45:30.123Z").toISOString(),
        sbi: "111222333",
        frn: "444555666",
        crn: "777888999",
        defraId: "DEF456789",
      },
      answers: {
        preciseDecimal: 1234.56789,
        largeInteger: 9876543210,
        booleanValue: true,
        stringValue: "Test string with special chars: àéîôù",
      },
    };

    const response = await Wreck.post(
      `${env.API_URL}/grants/${grantCode}/applications`,
      {
        headers: { "x-cdp-request-id": `sns-types-test-${testId}` },
        payload: applicationData,
      },
    );
    expect(response.res.statusCode).toBe(204);

    // Poll for SNS event
    const snsMessage = await pollForSNSMessage(clientRef, 10000);
    expect(snsMessage).toBeTruthy();

    // Verify data type preservation
    const eventData = snsMessage.data;
    expect(eventData.answers.preciseDecimal).toBe(1234.56789);
    expect(typeof eventData.answers.preciseDecimal).toBe("number");

    expect(eventData.answers.largeInteger).toBe(9876543210);
    expect(typeof eventData.answers.largeInteger).toBe("number");

    expect(eventData.answers.booleanValue).toBe(true);
    expect(typeof eventData.answers.booleanValue).toBe("boolean");

    expect(eventData.answers.stringValue).toBe(
      "Test string with special chars: àéîôù",
    );
    expect(typeof eventData.answers.stringValue).toBe("string");

    // Verify timestamp precision
    expect(eventData.submittedAt).toBe("2025-02-14T14:45:30.123Z");

    console.log("✅ Data type preservation test completed");
  });
});

// Helper function to poll for SNS messages
async function pollForSNSMessage(clientRef, timeoutMs = 10000) {
  const startTime = Date.now();
  let attempts = 0;
  const maxAttempts = Math.ceil(timeoutMs / 500);

  while (attempts < maxAttempts && Date.now() - startTime < timeoutMs) {
    attempts++;
    try {
      const sqsResponse = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: env.GRANT_APPLICATION_CREATED_QUEUE,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 2,
        }),
      );

      if (sqsResponse.Messages?.length > 0) {
        const matchingMessage = sqsResponse.Messages.find((msg) => {
          const parsedMsg = JSON.parse(msg.Body);
          return parsedMsg.data.clientRef === clientRef;
        });

        if (matchingMessage) {
          return JSON.parse(matchingMessage.Body);
        }
      }
    } catch (error) {
      console.log(`SNS polling attempt ${attempts} failed:`, error.message);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}
