import { Verifier } from "@pact-foundation/pact";
import { afterAll, beforeAll, describe, it, vi } from "vitest";
import { getGrant } from "./load-grants.js";
import { buildVerifierOptions } from "./verifierConfig.js";

// Mock mongo-client at the top level before any imports
vi.mock("../../src/common/mongo-client.js", () => {
  const createCollectionMock = (name) => {
    if (name === "access_tokens") {
      const accessTokens = [
        {
          id: "12b9377cbe7e5c94e8a70d9d23929523d14afa954793130f8a3959c7b849aca8", // Hashed 00000000-0000-0000-0000-000000000000 token
          clientId: "contract-test",
        },
      ];

      return {
        findOne: vi.fn(async (query = {}) => {
          const { id } = query;
          return accessTokens.find((t) => t.id === id) || null;
        }),
      };
    }
    if (name === "applications") {
      return {
        findOne: vi.fn(async (query = {}) => {
          const { code, clientRef } = query;
          if (code === "frps-private-beta" && clientRef === "710-877-8fd") {
            return {
              code: "frps-private-beta",
              clientRef: "710-877-8fd",
              currentPhase: "PRE_AWARD",
              currentStage: "REVIEW_APPLICATION",
              currentStatus: "APPLICATION_RECEIVED",
              identifiers: {
                sbi: "107365747",
                frn: "1101313269",
                crn: "1103623923",
              },
              agreements: [],
            };
          }
          return null;
        }),
        findOneAndUpdate: vi.fn().mockResolvedValue(null), // Return null for outbox/inbox polling
        insertOne: vi.fn().mockResolvedValue({ insertedId: "test-id" }),
        insertMany: vi
          .fn()
          .mockResolvedValue({ insertedCount: 0, insertedIds: [] }),
        replaceOne: vi.fn().mockResolvedValue({ acknowledged: true }),
        updateOne: vi
          .fn()
          .mockResolvedValue({ acknowledged: true, matchedCount: 1 }),
        updateMany: vi
          .fn()
          .mockResolvedValue({ acknowledged: true, matchedCount: 0 }),
        createIndex: vi.fn().mockResolvedValue({ acknowledged: true }),
      };
    }

    // Grants collection - return grant based on query
    return {
      findOne: vi.fn(async (query = {}) => {
        const { code } = query;
        if (code === "frps-private-beta") {
          return getGrant("frps-private-beta");
        }
        return null;
      }),
      findOneAndUpdate: vi.fn().mockResolvedValue(null), // Return null for outbox/inbox polling
      insertOne: vi.fn().mockResolvedValue({ insertedId: "test-id" }),
      insertMany: vi
        .fn()
        .mockResolvedValue({ insertedCount: 0, insertedIds: [] }),
      replaceOne: vi.fn().mockResolvedValue({ acknowledged: true }),
      updateOne: vi
        .fn()
        .mockResolvedValue({ acknowledged: true, matchedCount: 1 }),
      updateMany: vi
        .fn()
        .mockResolvedValue({ acknowledged: true, matchedCount: 0 }),
      createIndex: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
  };

  const createMockSession = () => ({
    withTransaction: vi.fn().mockImplementation(async (callback) => {
      // Execute callback with mock session
      return callback({});
    }),
    endSession: vi.fn().mockResolvedValue(),
  });

  const mockMongoClient = {
    connect: vi.fn().mockResolvedValue(),
    close: vi.fn().mockResolvedValue(),
    startSession() {
      return createMockSession();
    },
  };

  return {
    mongoClient: mockMongoClient,
    db: {
      collection: vi.fn((name) => createCollectionMock(name)),
    },
    getReadPreference: vi.fn(),
  };
});

// Mock AWS services to avoid external dependencies
vi.mock("@aws-sdk/client-sns", () => ({
  SNSClient: vi.fn().mockImplementation(function () {
    return {
      send: vi.fn().mockResolvedValue({ MessageId: "test-message-id" }),
    };
  }),
  PublishCommand: vi.fn().mockImplementation(function () {}),
}));

vi.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: vi.fn().mockImplementation(function () {
    return {
      send: vi.fn().mockResolvedValue({ MessageId: "test-message-id" }),
    };
  }),
  SendMessageCommand: vi.fn(),
}));

// Mock migrate-mongo to avoid database migrations
vi.mock("migrate-mongo", () => ({
  up: vi.fn().mockResolvedValue([]),
}));

describe("fg-gas-backend Provider Verification", () => {
  let server;
  let mockPort;

  beforeAll(async () => {
    // Set environment variables for server configuration
    process.env.PORT = "0"; // Use random available port
    process.env.MONGO_URI = "mongodb://mocked-mongo/test"; // Mocked MongoDB URI
    process.env.MONGO_DATABASE = "test";
    process.env.SERVICE_NAME = "fg-gas-backend";
    process.env.SERVICE_VERSION = "test";
    process.env.LOG_ENABLED = "false";
    process.env.LOG_LEVEL = "error";
    process.env.LOG_FORMAT = "pino-pretty";
    process.env.TRACING_HEADER = "x-test";
    process.env.AWS_REGION = "eu-west-2";
    process.env.ENVIRONMENT = "test";
    process.env.OUTBOX_MAX_RETRIES = "5";
    process.env.OUTBOX_CLAIM_MAX_RECORDS = "2";
    process.env.OUTBOX_EXPIRES_MS = "5000";
    process.env.OUTBOX_POLL_MS = "1000";
    process.env.INBOX_MAX_RETRIES = "5";
    process.env.INBOX_CLAIM_MAX_RECORDS = "2";
    process.env.INBOX_EXPIRES_MS = "5000";
    process.env.INBOX_POLL_MS = "1000";

    // Start the real fg-gas-backend server with mocked dependencies
    const { createServer } = await import("../../src/server.js");
    const { grants } = await import("../../src/grants/index.js");
    const { health } = await import("../../src/health/index.js");

    server = await createServer();

    // Add error logging for debugging
    server.events.on(
      { name: "request", channels: "error" },
      (request, event) => {
        console.error("Request error:", event.error?.message || event.error);
        console.error("Stack:", event.error?.stack);
      },
    );

    await server.register([health, grants]);
    await server.start();
    mockPort = server.info.port;

    console.log(`Real fg-gas-backend server started on port ${mockPort}`);
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
    vi.restoreAllMocks();
  });

  describe("Contract Verification", () => {
    it("should verify contracts from grants-ui consumer", async () => {
      console.log(
        "Running contract verification against real fg-gas-backend with mocked dependencies",
      );

      const stateHandlers = {
        "frps-private-beta is configured in fg-gas-backend": async () => {
          console.log(
            "State: frps-private-beta is configured (real service, real data)",
          );
          return Promise.resolve();
        },

        "frps-private-beta is configured in fg-gas-backend with a client reference 710-877-8fd":
          async () => {
            console.log(
              "State: frps-private-beta with client ref 710-877-8fd (real service, mocked data)",
            );
            return Promise.resolve();
          },
      };

      const opts = buildVerifierOptions({
        providerName: "fg-gas-backend",
        providerBaseUrl: `http://localhost:${mockPort}`,
        stateHandlers,
      });

      return new Verifier(opts).verifyProvider();
    });
  });
});
