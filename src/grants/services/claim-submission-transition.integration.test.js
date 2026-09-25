import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const configVersion = "9.9.8";
const currentPosition = {
  phase: "PRE_AWARD",
  stage: "ASSESSMENT",
  status: "APPLICATION_RECEIVED",
};
const targetPosition = {
  phase: "PRE_AWARD",
  stage: "ASSESSMENT",
  status: "AWARD_READY",
};
const mismatchPosition = {
  phase: "PRE_AWARD",
  stage: "ASSESSMENT",
  status: "IN_PROGRESS",
};

let replSet;
let mongoClient;
let db;
let submitClaim;
let saveApplication;
let saveGrant;
let createTestApplication;
let createTestGrant;
let config;
let fixtureNumber = 0;

const entitlementTemplate = (maximumClaims) => ({
  claimCode: "ENT_CLAIMABLE",
  name: "Claimable entitlement",
  materialised: false,
  maxEntitlements: 1,
  fields: {
    area: {
      input: true,
      label: "Area",
      unitType: "decimal",
      decimalPlaces: 2,
      unit: "HA",
    },
  },
  availableAt: [currentPosition],
  claim: {
    claimableAt: [currentPosition, mismatchPosition],
    limits: { maximumClaims },
    requiresApproval: true,
  },
});

const phases = (targetReachable = true) => [
  {
    code: "PRE_AWARD",
    stages: [
      {
        code: "ASSESSMENT",
        statuses: [
          { code: "APPLICATION_RECEIVED", validFrom: [] },
          { code: "IN_PROGRESS", validFrom: [] },
          {
            code: "AWARD_READY",
            validFrom: [
              {
                code: targetReachable
                  ? "APPLICATION_RECEIVED"
                  : "SOME_OTHER_STATUS",
                processes: [],
              },
            ],
          },
        ],
      },
    ],
  },
];

const claimCommand = ({ code, clientRef, entitlementId, clientClaimRef }) => ({
  code,
  clientRef,
  payload: {
    metadata: {
      grantCode: code,
      clientRef,
      clientClaimRef,
      sbi: "106284736",
      frn: "1101234567",
    },
    claim: { entitlementId, totalClaimAmountPence: 4200 },
  },
});

const seedFixture = async (options = {}) => {
  const { maximumClaims, position, claimsConfigured, targetReachable } = {
    maximumClaims: 1,
    position: currentPosition,
    claimsConfigured: true,
    targetReachable: true,
    ...options,
  };
  fixtureNumber += 1;
  const code = `claim-transition-${fixtureNumber}`;
  const clientRef = `application-${fixtureNumber}`;
  const entitlementId = `entitlement-${fixtureNumber}`;

  await saveGrant(
    createTestGrant({
      code,
      version: configVersion,
      phases: phases(targetReachable),
      entitlementTemplates: [entitlementTemplate(maximumClaims)],
      claims: claimsConfigured
        ? { onClaimApproval: { currentPosition, targetPosition } }
        : undefined,
    }),
  );
  await db.collection("config_versions").insertOne({
    grantCode: code,
    version: configVersion,
    major: 9,
    minor: 9,
    patch: 8,
    status: "active",
    s3Bucket: "unused",
    s3Key: `${code}/gas.json`,
    definitions: {
      grant: { s3Key: `${code}/gas.json`, fetchStatus: "fetched" },
    },
  });
  await saveApplication(
    createTestApplication({
      code,
      clientRef,
      configVersion,
      currentPhase: position.phase,
      currentStage: position.stage,
      currentStatus: position.status,
    }),
  );
  await db.collection("entitlements").insertOne({
    id: entitlementId,
    code,
    clientRef,
    claimCode: "ENT_CLAIMABLE",
    instanceNumber: 1,
  });

  return {
    code,
    clientRef,
    entitlementId,
    command: (clientClaimRef = "claim-1") =>
      claimCommand({ code, clientRef, entitlementId, clientClaimRef }),
  };
};

const applicationFor = ({ code, clientRef }) =>
  db.collection("applications").findOne({ code, clientRef });
const countCommands = (fixture) =>
  db.collection("outbox").countDocuments({
    target: config.sns.updateCaseStatusTopicArn,
    "event.type": { $regex: /\.case\.update\.status$/ },
    "event.data.caseRef": fixture.clientRef,
  });
const countStatusEvents = (fixture) =>
  db.collection("outbox").countDocuments({
    target: config.sns.grantApplicationStatusUpdatedTopicArn,
    "event.data.clientRef": fixture.clientRef,
  });
const countAudits = () =>
  db.collection("outbox").countDocuments({
    target: config.sns.auditTopicArn,
  });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "claim-submission-transition-test");
  vi.resetModules();

  ({ mongoClient, db } = await import("../../common/mongo-client.js"));
  ({ config } = await import("../../common/config.js"));
  ({ submitClaim } = await import("./claims.service.js"));
  ({ save: saveApplication } =
    await import("../repositories/application.repository.js"));
  ({ save: saveGrant } = await import("../repositories/grant.repository.js"));
  ({ createTestApplication } =
    await import("../../../test/helpers/applications.js"));
  ({ createTestGrant } = await import("../../../test/helpers/grants.js"));

  await mongoClient.connect();
}, 120_000);

beforeEach(async () => {
  await Promise.all(
    [
      "applications",
      "claims",
      "config_versions",
      "entitlements",
      "grants",
      "outbox",
    ].map((collection) => db.collection(collection).deleteMany({})),
  );
});

afterAll(async () => {
  await mongoClient?.close();
  await replSet?.stop();
  vi.unstubAllEnvs();
}, 120_000);

describe("Claim submission application transition", () => {
  it("leaves the application unchanged while claim capacity remains", async () => {
    const fixture = await seedFixture({ maximumClaims: 2 });

    await expect(submitClaim(fixture.command())).resolves.toMatchObject({
      created: true,
    });

    await expect(
      db.collection("claims").countDocuments({ code: fixture.code }),
    ).resolves.toBe(1);
    await expect(applicationFor(fixture)).resolves.toMatchObject({
      currentStatus: currentPosition.status,
    });
    await expect(countCommands(fixture)).resolves.toBe(0);
    await expect(countStatusEvents(fixture)).resolves.toBe(0);
  });

  it("moves the application and publishes the normal event, command, and audits on the final claim", async () => {
    const fixture = await seedFixture();

    await expect(submitClaim(fixture.command())).resolves.toMatchObject({
      created: true,
    });

    await expect(applicationFor(fixture)).resolves.toMatchObject({
      currentStatus: targetPosition.status,
    });
    await expect(countCommands(fixture)).resolves.toBe(1);
    await expect(countStatusEvents(fixture)).resolves.toBe(1);
    await expect(countAudits(fixture)).resolves.toBe(2);
    await expect(
      db.collection("outbox").findOne({
        target: config.sns.updateCaseStatusTopicArn,
        "event.type": { $regex: /\.case\.update\.status$/ },
      }),
    ).resolves.toMatchObject({
      event: {
        data: {
          caseRef: fixture.clientRef,
          workflowCode: fixture.code,
          newStatus: "PRE_AWARD:ASSESSMENT:AWARD_READY",
          supplementaryData: {
            currentConfigVersion: configVersion,
            phase: currentPosition.phase,
            stage: currentPosition.stage,
          },
        },
      },
    });
  });

  it("does not transition when the final claim is submitted from a different position", async () => {
    const fixture = await seedFixture({ position: mismatchPosition });

    await expect(submitClaim(fixture.command())).resolves.toMatchObject({
      created: true,
    });

    await expect(applicationFor(fixture)).resolves.toMatchObject({
      currentStatus: mismatchPosition.status,
    });
    await expect(countCommands(fixture)).resolves.toBe(0);
  });

  it("does not transition when claim approval configuration is absent", async () => {
    const fixture = await seedFixture({ claimsConfigured: false });

    await expect(submitClaim(fixture.command())).resolves.toMatchObject({
      created: true,
    });

    await expect(applicationFor(fixture)).resolves.toMatchObject({
      currentStatus: currentPosition.status,
    });
    await expect(countCommands(fixture)).resolves.toBe(0);
  });

  it("does not repeat the transition or command when a claim is replayed", async () => {
    const fixture = await seedFixture();

    await expect(submitClaim(fixture.command())).resolves.toMatchObject({
      created: true,
    });
    await expect(submitClaim(fixture.command())).resolves.toEqual({
      created: false,
    });

    await expect(
      db.collection("claims").countDocuments({ code: fixture.code }),
    ).resolves.toBe(1);
    await expect(countCommands(fixture)).resolves.toBe(1);
    await expect(countStatusEvents(fixture)).resolves.toBe(1);
    await expect(applicationFor(fixture)).resolves.toMatchObject({
      currentStatus: targetPosition.status,
    });
  });

  it("serializes concurrent final claims so only one transition commits", async () => {
    const fixture = await seedFixture();

    const results = await Promise.allSettled([
      submitClaim(fixture.command("claim-concurrent-1")),
      submitClaim(fixture.command("claim-concurrent-2")),
    ]);

    expect(
      results.filter(
        (result) => result.status === "fulfilled" && result.value.created,
      ),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await expect(
      db.collection("claims").countDocuments({ code: fixture.code }),
    ).resolves.toBe(1);
    await expect(countCommands(fixture)).resolves.toBe(1);
    await expect(applicationFor(fixture)).resolves.toMatchObject({
      currentStatus: targetPosition.status,
    });
  });

  it("rolls back the claim, application, events, and audits when the transition is invalid", async () => {
    const fixture = await seedFixture({ targetReachable: false });
    const applicationBefore = await applicationFor(fixture);

    await expect(submitClaim(fixture.command())).rejects.toThrow(
      /Invalid transition from "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED" to "PRE_AWARD:ASSESSMENT:AWARD_READY"/,
    );

    await expect(
      db.collection("claims").countDocuments({ code: fixture.code }),
    ).resolves.toBe(0);
    await expect(db.collection("outbox").countDocuments({})).resolves.toBe(0);
    await expect(applicationFor(fixture)).resolves.toEqual(applicationBefore);
  });
});
