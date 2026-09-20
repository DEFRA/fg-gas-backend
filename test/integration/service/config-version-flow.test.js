import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../../../src/common/config.js";
import {
  updateDefinitionFetchStatus,
  updateDefinitionLocation,
} from "../../../src/common/config-broker/config-catalog.repository.js";
import { FetchStatus } from "../../../src/grants/models/config-version.js";
import { processConfigVersionUseCase } from "../../../src/grants/use-cases/process-config-version.use-case.js";

let client;
let configVersionsCol;

const BUCKET = "config-broker-local";

// Real S3 against the floci emulator, as the rest of the config broker integration
// tests do. The bucket is seeded by compose/floci/start.d/10-setup-resources.sh.
const s3Client = new S3Client({
  region: config.region,
  endpoint: config.awsEndpointUrl,
  forcePathStyle: true,
});

const seedFixture = (path) =>
  JSON.parse(
    readFileSync(new URL(`../../../compose/seed/${path}`, import.meta.url)),
  );

const grantDefinition = seedFixture("woodland/1.28.2/gas/gas.json");
const paymentDefinition = seedFixture("woodland/1.28.2/gas/payment.json");
const agreementDefinition = seedFixture(
  "pigs-might-fly/1.0.0/gas/agreement.json",
);

const put = (key, definition) =>
  s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(definition),
      ContentType: "application/json",
    }),
  );

// Every definition a manifest names is now fetched and built before the version is
// recorded, so the versions these tests invent need real files behind them. The
// agreement fixture carries its own code, which has to match the grant being released.
const uploadDefinitions = () =>
  Promise.all([
    ...[
      "woodland/1.2.3/gas/gas.json",
      "woodland/1.2.4/gas/gas.json",
      "woodland/1.2.5/gas/gas.json",
      "woodland/1.2.7/gas/gas.json",
      "woodland/2.0.0/gas/gas.json",
      "farm-payments/1.2.6/gas/gas.json",
    ].map((key) => put(key, grantDefinition)),
    put("woodland/1.2.4/gas/agreement.json", {
      ...agreementDefinition,
      code: "woodland",
    }),
    put("woodland/1.2.5/gas/agreement.json", {
      ...agreementDefinition,
      code: "woodland",
    }),
    put("farm-payments/1.2.6/gas/agreement.json", {
      ...agreementDefinition,
      code: "frps-private-beta",
    }),
    put("woodland/1.2.7/gas/payment.json", paymentDefinition),
  ]);

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db(env.MONGO_DATABASE);
  configVersionsCol = db.collection("config_versions");
  await uploadDefinitions();
});

afterAll(async () => {
  await client?.close();
});

// Config broker messages reach this use case from the Inbox worker, not from the SQS
// subscriber: the subscriber only saves the event (FGP-1423).
describe("config broker message flow", () => {
  it("should process a config broker message and create a config_versions record", async () => {
    await processConfigVersionUseCase({
      grantCode: "woodland",
      version: "1.2.3",
      status: "active",
      s3Bucket: BUCKET,
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
    expect(cvDoc.definitions.grant).toMatchObject({
      s3Key: "woodland/1.2.3/gas/gas.json",
      fetchStatus: FetchStatus.Pending,
      fetchAttempts: 0,
    });
    expect(cvDoc.fetchStatus).toBeUndefined();
    expect(cvDoc.s3Key).toBeUndefined();
    expect(cvDoc.definitions.agreement).toBeUndefined();
  });

  it("records an optional Agreement definition independently", async () => {
    await processConfigVersionUseCase({
      grantCode: "woodland",
      version: "1.2.4",
      status: "active",
      s3Bucket: BUCKET,
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

  it("records an optional Payment definition independently", async () => {
    await processConfigVersionUseCase({
      grantCode: "woodland",
      version: "1.2.7",
      status: "active",
      s3Bucket: BUCKET,
      manifest: [
        "woodland/1.2.7/gas/gas.json",
        "woodland/1.2.7/gas/payment.json",
      ],
    });

    const doc = await configVersionsCol.findOne({
      grantCode: "woodland",
      version: "1.2.7",
    });
    expect(doc.definitions.payment).toMatchObject({
      s3Key: "woodland/1.2.7/gas/payment.json",
      fetchStatus: FetchStatus.Pending,
      fetchAttempts: 0,
    });
    expect(doc.definitions.agreement).toBeUndefined();
  });

  it("does not reset Agreement fetch state on a duplicate message", async () => {
    const event = {
      grantCode: "woodland",
      version: "1.2.5",
      status: "active",
      s3Bucket: BUCKET,
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

  it("does not create a config version record when the parent is missing", async () => {
    await updateDefinitionLocation({
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

  it("stores the publishing grant's paths for an aliased release", async () => {
    await processConfigVersionUseCase({
      grantCode: "frps-private-beta",
      version: "1.2.6",
      status: "active",
      s3Bucket: BUCKET,
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
    expect(doc.definitions.grant.s3Key).toBe(
      "farm-payments/1.2.6/gas/gas.json",
    );
    expect(doc.s3Key).toBeUndefined();
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
        s3Bucket: BUCKET,
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
      s3Bucket: BUCKET,
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
