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
import {
  updateDefinitionFetchStatus,
  upsertDefinitionLocation,
} from "../../../src/common/config-broker/config-catalog.repository.js";
import { FetchStatus } from "../../../src/grants/models/config-version.js";
import { processConfigVersionUseCase } from "../../../src/grants/use-cases/process-config-version.use-case.js";

let client;
let configVersionsCol;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db(env.MONGO_DATABASE);
  configVersionsCol = db.collection("config_versions");
});

beforeEach(async () => {
  await configVersionsCol.deleteMany({});
});

afterEach(async () => {
  await configVersionsCol.deleteMany({});
});

afterAll(async () => {
  await client?.close();
});

// Config broker messages are delivered by the SQS subscriber, which calls
// processConfigVersionUseCase directly (the broker topic is a standard,
// non-FIFO SNS topic, so the inbox pattern adds nothing here).
describe("config broker message flow", () => {
  it("should process a config broker message and create a config_versions record", async () => {
    await processConfigVersionUseCase({
      grantCode: "woodland",
      version: "1.2.3",
      status: "active",
      manifest: ["woodland/1.2.3/gas/gas.json", "woodland/1.2.3/metadata.json"],
    });

    const cvDoc = await configVersionsCol.findOne({
      grantCode: "woodland",
      version: "1.2.3",
    });
    expect(cvDoc).not.toBeNull();
    expect(cvDoc.major).toBe(1);
    expect(cvDoc.minor).toBe(2);
    expect(cvDoc.patch).toBe(3);
    expect(cvDoc.fetchStatus).toBe(FetchStatus.Pending);
    expect(cvDoc.s3Key).toBe("woodland/1.2.3/gas/gas.json");
    expect(cvDoc.definitions.grant).toMatchObject({
      s3Key: cvDoc.s3Key,
      fetchStatus: FetchStatus.Pending,
      fetchAttempts: 0,
    });
    expect(cvDoc.definitions.agreement).toBeUndefined();
  });

  it("records an optional Agreement definition independently", async () => {
    await processConfigVersionUseCase({
      grantCode: "woodland",
      version: "1.2.4",
      status: "active",
      manifest: [
        "woodland/1.2.4/gas/gas.json",
        "woodland/1.2.4/gas/agreement.json",
      ],
    });

    const doc = await configVersionsCol.findOne({
      grantCode: "woodland",
      version: "1.2.4",
    });
    expect(doc.definitions.agreement).toMatchObject({
      s3Key: "woodland/1.2.4/gas/agreement.json",
      fetchStatus: FetchStatus.Pending,
      fetchAttempts: 0,
    });
  });

  it("does not reset Agreement fetch state on a duplicate message", async () => {
    const event = {
      grantCode: "woodland",
      version: "1.2.5",
      status: "active",
      manifest: [
        "woodland/1.2.5/gas/gas.json",
        "woodland/1.2.5/gas/agreement.json",
      ],
    };
    await processConfigVersionUseCase(event);
    await updateDefinitionFetchStatus({
      grantCode: "woodland",
      version: "1.2.5",
      definitionType: "agreement",
      fetchStatus: FetchStatus.Fetched,
    });

    await processConfigVersionUseCase(event);

    const doc = await configVersionsCol.findOne({
      grantCode: "woodland",
      version: "1.2.5",
    });
    expect(doc.definitions.agreement).toMatchObject({
      fetchStatus: FetchStatus.Fetched,
      fetchAttempts: 0,
      s3Key: "woodland/1.2.5/gas/agreement.json",
    });
  });

  // Proves the guarantee at the database rather than the call: a definition
  // location for a version that was never ingested must write nothing at all.
  it("does not create a config version record when the parent is missing", async () => {
    await upsertDefinitionLocation({
      grantCode: "never-ingested",
      version: "9.9.9",
      definitionType: "agreement",
      s3Key: "never-ingested/9.9.9/gas/agreement.json",
    });

    await expect(
      configVersionsCol.findOne({
        grantCode: "never-ingested",
        version: "9.9.9",
      }),
    ).resolves.toBeNull();
  });

  // The broker republishes an aliased release under the alias but leaves the
  // publishing grant's paths in the manifest, so the stored keys must follow
  // the manifest rather than the grant code on the message.
  it("stores the publishing grant's paths for an aliased release", async () => {
    await processConfigVersionUseCase({
      grantCode: "frps-private-beta",
      version: "1.2.6",
      status: "active",
      manifest: [
        "farm-payments/1.2.6/gas/gas.json",
        "farm-payments/1.2.6/gas/agreement.json",
        "farm-payments/1.2.6/metadata.json",
      ],
    });

    const doc = await configVersionsCol.findOne({
      grantCode: "frps-private-beta",
      version: "1.2.6",
    });
    expect(doc.s3Key).toBe("farm-payments/1.2.6/gas/gas.json");
    expect(doc.definitions.agreement).toMatchObject({
      s3Key: "farm-payments/1.2.6/gas/agreement.json",
      fetchStatus: FetchStatus.Pending,
    });
  });

  it("should reject a config version with invalid semver and create no record", async () => {
    await expect(
      processConfigVersionUseCase({
        grantCode: "woodland",
        version: "not-a-version",
        status: "active",
        manifest: ["woodland/1.0.0/gas/gas.json"],
      }),
    ).rejects.toThrow("Invalid semver version");

    const cvCount = await configVersionsCol.countDocuments({
      grantCode: "woodland",
    });
    expect(cvCount).toBe(0);
  });

  it("should handle duplicate messages via upsert without error", async () => {
    const eventData = {
      grantCode: "woodland",
      version: "2.0.0",
      status: "active",
      manifest: ["woodland/2.0.0/gas/gas.json", "woodland/2.0.0/metadata.json"],
    };

    await processConfigVersionUseCase(eventData);
    await processConfigVersionUseCase(eventData);

    const cvCount = await configVersionsCol.countDocuments({
      grantCode: "woodland",
      version: "2.0.0",
    });
    expect(cvCount).toBe(1);
  });
});
