import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../../../src/common/config.js";
import {
  ConfigVersion,
  FetchStatus,
} from "../../../src/grants/models/config-version.js";
import { EntitlementTemplate } from "../../../src/grants/models/entitlement-template.js";
import { upsert } from "../../../src/grants/repositories/config-version.repository.js";
import { resolveAndFetchGrant } from "../../../src/grants/services/resolve-config-version.service.js";

// No mocking of ../../../src/common/s3-client.js here: this exercises the
// real S3Client against the floci S3-compatible emulator that the compose
// stack already seeds a "config-broker-local" bucket into (see
// compose/floci/start.d/10-setup-resources.sh), so the whole ingestion
// pipeline runs for real end to end.
const s3Client = new S3Client({
  region: config.region,
  endpoint: config.awsEndpointUrl,
  forcePathStyle: true,
});

let client;
let grants;
let configVersions;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db(env.MONGO_DATABASE);
  grants = db.collection("grants");
  configVersions = db.collection("config_versions");
});

afterAll(async () => {
  await client?.close();
});

const phases = [
  {
    code: "PHASE_PRE_AWARD",
    stages: [
      {
        code: "STAGE_PREPARE_CLAIM",
        statuses: [{ code: "STATUS_PREPARING_CLAIM", validFrom: [] }],
      },
    ],
  },
  {
    code: "PHASE_CLAIM",
    stages: [
      {
        code: "STAGE_AWAITING_CLAIM",
        statuses: [{ code: "STATUS_AWAITING_CLAIM", validFrom: [] }],
      },
      {
        code: "STAGE_CLAIM_COMPLETE",
        statuses: [{ code: "STATUS_CLAIM_COMPLETE", validFrom: [] }],
      },
    ],
  },
];

const entitlementTemplate = {
  claimCode: "ENT_CS_CAPITAL_PA3",
  name: "PA3 Woodland Management Plan entitlement",
  description:
    "The maximum eligible woodland area that can be claimed under PA3.",
  materialised: false,
  fields: {
    totalHectares: {
      input: true,
      label: "Total area of eligible woodland",
      unitType: "decimal",
      decimalPlaces: 4,
      unit: "HA",
      minValue: 0.5,
      maxValue: null,
    },
    actionCode: {
      input: false,
      value: "PA3",
      unitType: "string",
      minLength: 1,
      maxLength: null,
    },
    actionVersion: {
      input: false,
      value: "jsonata: $.agreement.actions[code='PA3'].version",
      unitType: "string",
      minLength: 1,
      maxLength: null,
    },
  },
  maxEntitlements: 1,
  availableAt: {
    phase: "PHASE_PRE_AWARD",
    stage: "STAGE_PREPARE_CLAIM",
    status: "STATUS_PREPARING_CLAIM",
  },
  claim: {
    limits: { maximumClaims: 1, allowsPartialClaims: false },
    requiresApproval: false,
    requiresEvidence: false,
  },
};

const uploadGrantDefinition = async (bucket, key, definition) => {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(definition),
      ContentType: "application/json",
    }),
  );
};

const seedPendingConfigVersion = async (grantCode, version, s3Key) => {
  const cv = ConfigVersion.new({
    grantCode,
    version,
    status: "active",
    s3Key,
    s3Bucket: "config-broker-local",
  });
  await upsert(cv);
  return cv;
};

describe("config broker entitlementTemplates ingestion (real S3)", () => {
  it("fetches the grant definition from a real S3-compatible bucket and creates the grant", async () => {
    const grantCode = "woodland-entitlements-real-s3";
    const version = "1.0.0";
    const s3Key = `${grantCode}/${version}/gas/gas.json`;

    await uploadGrantDefinition("config-broker-local", s3Key, {
      code: grantCode,
      metadata: {
        description: "Woodland Management Plan",
        startDate: "2100-01-01T00:00:00.000Z",
      },
      actions: [],
      amendablePositions: [],
      phases,
      entitlementTemplates: [entitlementTemplate],
    });
    await seedPendingConfigVersion(grantCode, version, s3Key);

    const result = await resolveAndFetchGrant(grantCode, version);

    expect(result.definitionSource).toBe("s3");
    expect(result.grant.entitlementTemplates[0]).toBeInstanceOf(
      EntitlementTemplate,
    );
    expect(result.grant.findEntitlementTemplate("ENT_CS_CAPITAL_PA3")).toEqual(
      entitlementTemplate,
    );

    const storedDoc = await grants.findOne({ code: grantCode, version });
    expect(storedDoc).not.toBeNull();
    expect(storedDoc.entitlementTemplates).toEqual([entitlementTemplate]);

    const cvDoc = await configVersions.findOne({ grantCode, version });
    expect(cvDoc.fetchStatus).toBe(FetchStatus.Fetched);
  });

  it("rejects and persists nothing when the real S3 object has a reference-integrity error", async () => {
    const grantCode = "woodland-entitlements-real-s3-invalid";
    const version = "1.0.0";
    const s3Key = `${grantCode}/${version}/gas/gas.json`;

    await uploadGrantDefinition("config-broker-local", s3Key, {
      code: grantCode,
      metadata: {
        description: "Woodland Management Plan",
        startDate: "2100-01-01T00:00:00.000Z",
      },
      actions: [],
      amendablePositions: [],
      phases,
      entitlementTemplates: [
        {
          ...entitlementTemplate,
          availableAt: {
            phase: "PHASE_CLAIM",
            stage: "STAGE_CLAIM_COMPLETE",
            status: "STATUS_UNKNOWN",
          },
        },
      ],
    });
    await seedPendingConfigVersion(grantCode, version, s3Key);

    await expect(resolveAndFetchGrant(grantCode, version)).rejects.toThrow(
      /is available at position "PHASE_CLAIM:STAGE_CLAIM_COMPLETE:STATUS_UNKNOWN" which does not match any position in "phases"/,
    );

    const storedDoc = await grants.findOne({ code: grantCode, version });
    expect(storedDoc).toBeNull();
  });
});
