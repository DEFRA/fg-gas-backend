import { MongoClient } from "mongodb";
import { env } from "node:process";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  ConfigVersion,
  FetchStatus,
} from "../../../src/grants/models/config-version.js";
import { EntitlementTemplate } from "../../../src/grants/models/entitlement-template.js";
import { upsert } from "../../../src/grants/repositories/config-version.repository.js";
import { resolveAndFetchGrant } from "../../../src/grants/services/resolve-config-version.service.js";

vi.mock("../../../src/common/s3-client.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    fetchConfigFile: vi.fn(),
  };
});

const { fetchConfigFile } = await import("../../../src/common/s3-client.js");

let client;
let grants;
let configVersions;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db(env.MONGO_DATABASE);
  grants = db.collection("grants");
  configVersions = db.collection("config_versions");
});

beforeEach(() => {
  // Mongo collections are purged by the global test/cleanup.js beforeEach.
  // Mocks are not: the integration vitest config sets no clearMocks.
  vi.clearAllMocks();
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

const availableAt = {
  phase: "PHASE_PRE_AWARD",
  stage: "STAGE_PREPARE_CLAIM",
  status: "STATUS_PREPARING_CLAIM",
};

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
  availableAt,
  claim: {
    limits: { maximumClaims: 1, allowsPartialClaims: false },
    requiresApproval: false,
    requiresEvidence: false,
  },
};

const seedPendingConfigVersion = async (grantCode, version) => {
  const cv = ConfigVersion.new({
    grantCode,
    version,
    status: "active",
    s3Key: `${grantCode}/${version}/gas/gas.json`,
    s3Bucket: "config-broker-local",
  });
  await upsert(cv);
  return cv;
};

describe("config broker entitlementTemplates ingestion", () => {
  it("fetches from S3, persists entitlementTemplates, and rehydrates them from Mongo on the next resolve", async () => {
    const grantCode = "woodland-entitlements";
    const version = "1.0.0";

    await seedPendingConfigVersion(grantCode, version);
    fetchConfigFile.mockResolvedValue({
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

    const firstResult = await resolveAndFetchGrant(grantCode, version);

    expect(firstResult.definitionSource).toBe("s3");
    expect(firstResult.grant.entitlementTemplates[0]).toBeInstanceOf(
      EntitlementTemplate,
    );
    expect(
      firstResult.grant.findEntitlementTemplate("ENT_CS_CAPITAL_PA3"),
    ).toEqual(entitlementTemplate);

    const storedDoc = await grants.findOne({ code: grantCode, version });
    expect(storedDoc.entitlementTemplates).toEqual([entitlementTemplate]);

    const secondResult = await resolveAndFetchGrant(grantCode, version);

    expect(secondResult.definitionSource).toBe("mongodb");
    expect(fetchConfigFile).toHaveBeenCalledTimes(1);
    expect(secondResult.grant.entitlementTemplates[0]).toBeInstanceOf(
      EntitlementTemplate,
    );
    expect(
      secondResult.grant
        .findEntitlementTemplate("ENT_CS_CAPITAL_PA3")
        .isAvailableAt(availableAt),
    ).toBe(true);
  });

  // The commonest template of all: materialised, so it carries none of the
  // optional keys. The driver stores those as null, and the next resolve reads
  // them straight back into the model - so this is the case where a
  // write-once-read-never bug would actually bite, and the PA3 fixture above is
  // too fully-populated to catch it.
  it("persists and rehydrates a materialised template that omits every optional key", async () => {
    const grantCode = "tractor-entitlements";
    const version = "1.0.0";

    await seedPendingConfigVersion(grantCode, version);
    fetchConfigFile.mockResolvedValue({
      code: grantCode,
      metadata: {
        description: "Tractor grant",
        startDate: "2100-01-01T00:00:00.000Z",
      },
      actions: [],
      amendablePositions: [],
      phases,
      entitlementTemplates: [
        {
          claimCode: "ENT_TRACTOR",
          name: "Tractor entitlement",
          availableAt,
        },
      ],
    });

    await resolveAndFetchGrant(grantCode, version);

    const storedDoc = await grants.findOne({ code: grantCode, version });
    const [storedTemplate] = storedDoc.entitlementTemplates;
    expect(storedTemplate.description).toBeNull();
    expect(storedTemplate.fields).toBeNull();
    expect(storedTemplate.claim).toBeNull();

    const secondResult = await resolveAndFetchGrant(grantCode, version);

    expect(secondResult.definitionSource).toBe("mongodb");

    const template = secondResult.grant.findEntitlementTemplate("ENT_TRACTOR");
    expect(template.materialised).toBe(true);
    expect(template.description).toBeUndefined();
    expect(template.fields).toBeUndefined();
    expect(template.claim).toBeUndefined();
    expect(template.isAvailableAt(availableAt)).toBe(true);
  });

  it("rejects and persists nothing when an entitlement template references a position missing from phases", async () => {
    const grantCode = "woodland-entitlements-invalid";
    const version = "1.0.0";

    await seedPendingConfigVersion(grantCode, version);
    fetchConfigFile.mockResolvedValue({
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

    await expect(resolveAndFetchGrant(grantCode, version)).rejects.toThrow(
      /is available at position "PHASE_CLAIM:STAGE_CLAIM_COMPLETE:STATUS_UNKNOWN" which does not match any phase:stage:status/,
    );

    const storedDoc = await grants.findOne({ code: grantCode, version });
    expect(storedDoc).toBeNull();

    // Latched as permanent so the bad config is not re-fetched and re-thrown
    // on every subsequent request.
    const cvDoc = await configVersions.findOne({ grantCode, version });
    expect(cvDoc.fetchStatus).toBe(FetchStatus.PermanentError);
  });
});
