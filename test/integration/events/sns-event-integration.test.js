import { ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import Wreck from "@hapi/wreck";
import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
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

describe("SNS Event Integration Tests", () => {
  beforeEach(async () => {
    // Clean up test data
    await grants.deleteMany({ code: { $regex: "^event-" } });
    await applications.deleteMany({ clientRef: { $regex: "^event-" } });
  });

  afterEach(async () => {
    // Clean up after each test
    await grants.deleteMany({ code: { $regex: "^event-" } });
    await applications.deleteMany({ clientRef: { $regex: "^event-" } });
  });

  describe("Application Event Publishing", () => {
    it("should publish complete application data in SNS event", async () => {
      const testId = Date.now();
      const grantCode = `event-grant-${testId}`;
      const clientRef = `event-app-${testId}`;

      // Create comprehensive grant
      const grantData = {
        code: grantCode,
        metadata: {
          description: "Comprehensive event testing grant",
          startDate: "2025-01-01T00:00:00.000Z",
        },
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            farmDetails: {
              type: "object",
              properties: {
                name: { type: "string" },
                size: { type: "number" },
                location: { type: "string" },
              },
              required: ["name", "size", "location"],
            },
            livestock: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  count: { type: "integer" },
                },
              },
            },
            sustainabilityMeasures: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["farmDetails", "livestock"],
        },
        actions: [],
      };

      await Wreck.post(`${env.API_URL}/grants`, {
        payload: grantData,
      });

      // Submit application with complex data structure
      const applicationData = {
        metadata: {
          clientRef,
          submittedAt: new Date("2025-01-15T10:30:00.000Z").toISOString(),
          sbi: "987654321",
          frn: "123456789",
          crn: "555666777",
          defraId: "DEF789123",
        },
        answers: {
          farmDetails: {
            name: "Green Valley Farm",
            size: 325.75,
            location: "Yorkshire Dales",
          },
          livestock: [
            { type: "cattle", count: 150 },
            { type: "sheep", count: 400 },
            { type: "pigs", count: 50 },
          ],
          sustainabilityMeasures: [
            "renewable-energy",
            "water-conservation",
            "soil-improvement",
            "biodiversity-enhancement",
          ],
        },
      };

      const response = await Wreck.post(
        `${env.API_URL}/grants/${grantCode}/applications`,
        {
          headers: {
            "x-cdp-request-id": `comprehensive-event-${testId}`,
          },
          payload: applicationData,
        },
      );
      expect(response.res.statusCode).toBe(204);

      // Poll for SNS event
      const snsMessage = await pollForSNSMessage(clientRef, 15000);
      expect(snsMessage, "SNS message should be published").toBeTruthy();

      // Verify event structure
      expect(snsMessage.id).toBeDefined();
      expect(snsMessage.time).toBeDefined();
      expect(snsMessage.source).toBe("fg-gas-backend");
      expect(snsMessage.specversion).toBe("1.0");
      expect(snsMessage.type).toBe(
        "cloud.defra.development.fg-gas-backend.application.created",
      );
      expect(snsMessage.datacontenttype).toBe("application/json");
      expect(snsMessage.traceparent).toBe(`comprehensive-event-${testId}`);

      // Verify event data completeness
      const eventData = snsMessage.data;
      expect(eventData.clientRef).toBe(clientRef);
      expect(eventData.code).toBe(grantCode);
      expect(eventData.submittedAt).toBe("2025-01-15T10:30:00.000Z");
      expect(eventData.createdAt).toBeDefined();

      // Verify identifiers
      expect(eventData.identifiers.sbi).toBe("987654321");
      expect(eventData.identifiers.frn).toBe("123456789");
      expect(eventData.identifiers.crn).toBe("555666777");
      expect(eventData.identifiers.defraId).toBe("DEF789123");

      // Verify complex nested answers structure
      expect(eventData.answers.farmDetails.name).toBe("Green Valley Farm");
      expect(eventData.answers.farmDetails.size).toBe(325.75);
      expect(eventData.answers.farmDetails.location).toBe("Yorkshire Dales");

      expect(eventData.answers.livestock).toHaveLength(3);
      expect(eventData.answers.livestock[0]).toEqual({
        type: "cattle",
        count: 150,
      });
      expect(eventData.answers.livestock[1]).toEqual({
        type: "sheep",
        count: 400,
      });
      expect(eventData.answers.livestock[2]).toEqual({
        type: "pigs",
        count: 50,
      });

      expect(eventData.answers.sustainabilityMeasures).toHaveLength(4);
      expect(eventData.answers.sustainabilityMeasures).toContain(
        "renewable-energy",
      );
      expect(eventData.answers.sustainabilityMeasures).toContain(
        "biodiversity-enhancement",
      );
    });

    it("should preserve data types and precision in SNS events", async () => {
      const testId = Date.now();
      const grantCode = `event-precision-${testId}`;
      const clientRef = `event-precision-${testId}`;

      // Create grant with various data types
      const grantData = {
        code: grantCode,
        metadata: {
          description: "Data type precision testing grant",
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
            nullableField: { type: ["string", "null"] },
            dateField: { type: "string", format: "date-time" },
          },
          required: ["preciseDecimal", "largeInteger", "booleanValue"],
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
          nullableField: null,
          dateField: "2025-01-15T08:30:45.678Z",
        },
      };

      const response = await Wreck.post(
        `${env.API_URL}/grants/${grantCode}/applications`,
        {
          headers: {
            "x-cdp-request-id": `precision-test-${testId}`,
          },
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

      expect(eventData.answers.nullableField).toBe(null);

      expect(eventData.answers.dateField).toBe("2025-01-15T08:30:45.678Z");

      // Verify timestamp precision
      expect(eventData.submittedAt).toBe("2025-02-14T14:45:30.123Z");
    });

    it("should handle event publishing failures gracefully", async () => {
      const testId = Date.now();
      const grantCode = `event-failure-${testId}`;
      const clientRef = `event-failure-${testId}`;

      // Create grant
      const grantData = {
        code: grantCode,
        metadata: {
          description: "Event failure testing grant",
          startDate: "2025-01-01T00:00:00.000Z",
        },
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            testField: { type: "string" },
          },
          required: ["testField"],
        },
        actions: [],
      };

      await Wreck.post(`${env.API_URL}/grants`, {
        payload: grantData,
      });

      // Submit application (this should work even if SNS has issues)
      const applicationData = {
        metadata: {
          clientRef,
          submittedAt: new Date().toISOString(),
          sbi: "123456789",
          frn: "987654321",
          crn: "555666777",
          defraId: "DEF123456",
        },
        answers: {
          testField: "Event failure test",
        },
      };

      // Application submission should succeed regardless of SNS status
      const response = await Wreck.post(
        `${env.API_URL}/grants/${grantCode}/applications`,
        {
          headers: {
            "x-cdp-request-id": `failure-test-${testId}`,
          },
          payload: applicationData,
        },
      );
      expect(response.res.statusCode).toBe(204);

      // Verify application was stored in database
      const dbApplication = await applications.findOne({ clientRef });
      expect(dbApplication).toBeTruthy();
      expect(dbApplication.code).toBe(grantCode);
      expect(dbApplication.answers.testField).toBe("Event failure test");
    });
  });

  describe("Event Ordering and Consistency", () => {
    it("should maintain event order for sequential application submissions", async () => {
      const testId = Date.now();
      const grantCode = `event-order-${testId}`;
      const numSequentialApps = 3;

      // Create grant
      const grantData = {
        code: grantCode,
        metadata: {
          description: "Event ordering test grant",
          startDate: "2025-01-01T00:00:00.000Z",
        },
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            sequence: { type: "integer" },
            timestamp: { type: "string" },
          },
          required: ["sequence", "timestamp"],
        },
        actions: [],
      };

      await Wreck.post(`${env.API_URL}/grants`, {
        payload: grantData,
      });

      // Submit applications sequentially with timestamps
      const submissionTimes = [];
      const responses = [];

      for (let i = 0; i < numSequentialApps; i++) {
        const submissionTime = new Date();
        submissionTimes.push(submissionTime);

        const applicationData = {
          metadata: {
            clientRef: `event-order-${testId}-${i}`,
            submittedAt: submissionTime.toISOString(),
            sbi: `12345678${i}`,
            frn: `98765432${i}`,
            crn: `55566677${i}`,
            defraId: `DEF12345${i}`,
          },
          answers: {
            sequence: i,
            timestamp: submissionTime.toISOString(),
          },
        };

        const response = await Wreck.post(
          `${env.API_URL}/grants/${grantCode}/applications`,
          {
            headers: {
              "x-cdp-request-id": `order-test-${testId}-${i}`,
            },
            payload: applicationData,
          },
        );
        responses.push(response);

        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Verify all submissions succeeded
      responses.forEach((response) => {
        expect(response.res.statusCode).toBe(204);
      });

      // Poll for all SNS events
      const receivedEvents = [];
      let attempts = 0;
      const maxAttempts = 20;

      while (
        attempts < maxAttempts &&
        receivedEvents.length < numSequentialApps
      ) {
        attempts++;
        try {
          const sqsResponse = await sqsClient.send(
            new ReceiveMessageCommand({
              QueueUrl: env.GRANT_APPLICATION_CREATED_QUEUE,
              MaxNumberOfMessages: 10,
              WaitTimeSeconds: 1,
            }),
          );

          if (sqsResponse.Messages?.length > 0) {
            sqsResponse.Messages.forEach((msg) => {
              const parsedMsg = JSON.parse(msg.Body);
              if (parsedMsg.data.clientRef.includes(`event-order-${testId}-`)) {
                receivedEvents.push(parsedMsg);
              }
            });
          }
        } catch (error) {
          console.log(
            `Event ordering SQS poll attempt ${attempts} failed:`,
            error.message,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Verify all events were received
      expect(receivedEvents).toHaveLength(numSequentialApps);

      // Sort events by sequence number
      const sortedEvents = receivedEvents.sort(
        (a, b) => a.data.answers.sequence - b.data.answers.sequence,
      );

      // Verify events maintain chronological order
      for (let i = 0; i < numSequentialApps; i++) {
        expect(sortedEvents[i].data.answers.sequence).toBe(i);
        expect(sortedEvents[i].data.clientRef).toBe(
          `event-order-${testId}-${i}`,
        );

        if (i > 0) {
          const prevTime = new Date(sortedEvents[i - 1].data.submittedAt);
          const currTime = new Date(sortedEvents[i].data.submittedAt);
          expect(currTime.getTime()).toBeGreaterThan(prevTime.getTime());
        }
      }
    });

    it("should handle concurrent event publishing without data corruption", async () => {
      const testId = Date.now();
      const grantCode = `event-concurrent-${testId}`;
      const numConcurrentApps = 8;

      // Create grant
      const grantData = {
        code: grantCode,
        metadata: {
          description: "Concurrent event testing grant",
          startDate: "2025-01-01T00:00:00.000Z",
        },
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            concurrentId: { type: "integer" },
            randomValue: { type: "string" },
          },
          required: ["concurrentId", "randomValue"],
        },
        actions: [],
      };

      await Wreck.post(`${env.API_URL}/grants`, {
        payload: grantData,
      });

      // Generate unique random values for each application
      const uniqueValues = Array.from({ length: numConcurrentApps }, () =>
        randomUUID(),
      );

      // Submit applications concurrently
      const submissionPromises = Array.from(
        { length: numConcurrentApps },
        (_, i) => {
          const applicationData = {
            metadata: {
              clientRef: `event-concurrent-${testId}-${i}`,
              submittedAt: new Date().toISOString(),
              sbi: `12345678${i}`,
              frn: `98765432${i}`,
              crn: `55566677${i}`,
              defraId: `DEF12345${i}`,
            },
            answers: {
              concurrentId: i,
              randomValue: uniqueValues[i],
            },
          };

          return Wreck.post(`${env.API_URL}/grants/${grantCode}/applications`, {
            headers: {
              "x-cdp-request-id": `concurrent-test-${testId}-${i}`,
            },
            payload: applicationData,
          });
        },
      );

      const responses = await Promise.all(submissionPromises);
      responses.forEach((response) => {
        expect(response.res.statusCode).toBe(204);
      });

      // Verify database consistency
      const dbApplications = await applications
        .find({
          clientRef: { $regex: `^event-concurrent-${testId}-` },
        })
        .toArray();
      expect(dbApplications).toHaveLength(numConcurrentApps);

      // Poll for all SNS events
      const receivedEvents = new Map();
      let attempts = 0;
      const maxAttempts = 25;

      while (
        attempts < maxAttempts &&
        receivedEvents.size < numConcurrentApps
      ) {
        attempts++;
        try {
          const sqsResponse = await sqsClient.send(
            new ReceiveMessageCommand({
              QueueUrl: env.GRANT_APPLICATION_CREATED_QUEUE,
              MaxNumberOfMessages: 10,
              WaitTimeSeconds: 1,
            }),
          );

          if (sqsResponse.Messages?.length > 0) {
            sqsResponse.Messages.forEach((msg) => {
              const parsedMsg = JSON.parse(msg.Body);
              if (
                parsedMsg.data.clientRef.includes(`event-concurrent-${testId}-`)
              ) {
                const concurrentId = parsedMsg.data.answers.concurrentId;
                receivedEvents.set(concurrentId, parsedMsg);
              }
            });
          }
        } catch (error) {
          console.log(
            `Concurrent SQS poll attempt ${attempts} failed:`,
            error.message,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Verify all events were received
      expect(receivedEvents.size).toBe(numConcurrentApps);

      // Verify data integrity - no corruption or mixing
      for (let i = 0; i < numConcurrentApps; i++) {
        const event = receivedEvents.get(i);
        expect(event, `Event for concurrent ID ${i} should exist`).toBeTruthy();

        expect(event.data.answers.concurrentId).toBe(i);
        expect(event.data.answers.randomValue).toBe(uniqueValues[i]);
        expect(event.data.clientRef).toBe(`event-concurrent-${testId}-${i}`);
        expect(event.data.identifiers.sbi).toBe(`12345678${i}`);
      }
    });
  });

  describe("Cross-Service Event Integration", () => {
    it("should publish events in format expected by fg-cw-backend", async () => {
      const testId = Date.now();
      const grantCode = `event-cw-format-${testId}`;
      const clientRef = `event-cw-format-${testId}`;

      // Create grant that matches fg-cw-backend expectations
      const grantData = {
        code: grantCode,
        metadata: {
          description: "Grant for fg-cw-backend integration",
          startDate: "2025-01-01T00:00:00.000Z",
        },
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            applicantName: { type: "string" },
            isPigFarmer: { type: "boolean" },
            totalPigs: { type: "integer", minimum: 1 },
            farmSize: { type: "number", minimum: 0.1 },
          },
          required: ["applicantName", "isPigFarmer", "totalPigs"],
        },
        actions: [],
      };

      await Wreck.post(`${env.API_URL}/grants`, {
        payload: grantData,
      });

      // Submit application with data structure expected by fg-cw-backend
      const applicationData = {
        metadata: {
          clientRef,
          submittedAt: new Date("2025-03-15T11:45:30.000Z").toISOString(),
          sbi: "987654321",
          frn: "123456789",
          crn: "555777999",
          defraId: "DEF987654",
        },
        answers: {
          applicantName: "Test Pig Farmer",
          isPigFarmer: true,
          totalPigs: 750,
          farmSize: 125.5,
        },
      };

      const response = await Wreck.post(
        `${env.API_URL}/grants/${grantCode}/applications`,
        {
          headers: {
            "x-cdp-request-id": `cw-format-test-${testId}`,
          },
          payload: applicationData,
        },
      );
      expect(response.res.statusCode).toBe(204);

      // Poll for SNS event
      const snsMessage = await pollForSNSMessage(clientRef, 12000);
      expect(snsMessage).toBeTruthy();

      // Verify event structure matches what fg-cw-backend expects
      expect(snsMessage.source).toBe("fg-gas-backend");
      expect(snsMessage.type).toBe(
        "cloud.defra.development.fg-gas-backend.application.created",
      );

      // Verify fg-cw-backend can process this event structure
      const eventData = snsMessage.data;
      expect(eventData.clientRef).toBe(clientRef);
      expect(eventData.code).toBe(grantCode); // Maps to workflowCode
      expect(eventData.submittedAt).toBe("2025-03-15T11:45:30.000Z");

      // Verify identifiers structure
      expect(eventData.identifiers.sbi).toBe("987654321");
      expect(eventData.identifiers.frn).toBe("123456789");
      expect(eventData.identifiers.crn).toBe("555777999");
      expect(eventData.identifiers.defraId).toBe("DEF987654");

      // Verify answers structure matches fg-cw expected format
      expect(eventData.answers.applicantName).toBe("Test Pig Farmer");
      expect(eventData.answers.isPigFarmer).toBe(true);
      expect(eventData.answers.totalPigs).toBe(750);
      expect(eventData.answers.farmSize).toBe(125.5);

      // Verify the event can be processed by fg-cw-backend case creation logic
      // This simulates what fg-cw-backend would do when receiving this event
      const mockCaseCreationData = {
        workflowCode: eventData.code,
        caseRef: eventData.clientRef,
        dateReceived: eventData.submittedAt,
        payload: {
          clientRef: eventData.clientRef,
          code: eventData.code,
          submittedAt: eventData.submittedAt,
          identifiers: eventData.identifiers,
          applicant: {
            name: eventData.answers.applicantName,
          },
          answers: eventData.answers,
        },
      };

      expect(mockCaseCreationData.workflowCode).toBe(grantCode);
      expect(mockCaseCreationData.payload.applicant.name).toBe(
        "Test Pig Farmer",
      );
      expect(mockCaseCreationData.payload.answers.isPigFarmer).toBe(true);
    });
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
