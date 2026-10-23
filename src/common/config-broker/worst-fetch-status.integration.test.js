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
import { FetchStatus, fetchStatusRank } from "../fetch-status.js";

const TYPES = ["grant", "agreement", "payment"];

let replSet;
let mongoClient;
let configVersions;
let withWorstFetchStatus;
let updateDefinitionFetchStatus;
let upsert;
let updateFetchStatus;
let ConfigVersion;
let catalogRepository;
let configVersionRepository;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "worst-fetch-status-test");
  vi.resetModules();

  let db;
  ({ mongoClient, db } = await import("../mongo-client.js"));
  catalogRepository = await import("./config-catalog.repository.js");
  ({ withWorstFetchStatus, updateDefinitionFetchStatus } = catalogRepository);
  configVersionRepository =
    await import("../../grants/repositories/config-version.repository.js");
  ({ upsert, updateFetchStatus } = configVersionRepository);
  ({ ConfigVersion } = await import("../../grants/models/config-version.js"));

  await mongoClient.connect();
  configVersions = db.collection("config_versions");
}, 120_000);

afterAll(async () => {
  await mongoClient?.close();
  await replSet?.stop();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await configVersions.deleteMany({});
});

const subsets = (items) =>
  items.reduce(
    (all, item) => [...all, ...all.map((subset) => [...subset, item])],
    [[]],
  );

const assignments = (types) =>
  types.reduce(
    (all, type) =>
      all.flatMap((files) =>
        fetchStatusRank.map((fetchStatus) => ({
          ...files,
          [type]: { s3Key: `${type}.json`, fetchStatus },
        })),
      ),
    [{}],
  );

const worstOf = (definitions) =>
  fetchStatusRank[
    Math.max(
      ...Object.values(definitions).map(({ fetchStatus }) =>
        fetchStatusRank.indexOf(fetchStatus),
      ),
    )
  ];

const stamped = async (rows) => {
  await configVersions.insertMany(
    rows.map((fields, n) => ({
      grantCode: "woodland",
      version: `${n}`,
      ...fields,
    })),
  );
  await configVersions.updateMany({}, [withWorstFetchStatus]);

  return configVersions.find({}, { sort: { _id: 1 } }).toArray();
};

const arrive = (version, locations) =>
  upsert(
    ConfigVersion.new({
      grantCode: "woodland",
      version,
      status: "active",
      s3Key: `woodland/${version}/gas/gas.json`,
      s3Bucket: "bucket",
    }),
    locations,
  );

const versionOf = (version) =>
  configVersions.findOne({ grantCode: "woodland", version });

const record = (version, definitionType, fetchStatus, fetchError = null) =>
  updateDefinitionFetchStatus({
    grantCode: "woodland",
    version,
    definitionType,
    fetchStatus,
    fetchError,
  });

describe("withWorstFetchStatus", () => {
  it("is the worst fetch status of the files a version has, for every combination", async () => {
    const definitions = subsets(TYPES)
      .filter((types) => types.length > 0)
      .flatMap(assignments);

    const rows = await stamped(
      definitions.map((files) => ({ definitions: files })),
    );

    expect(rows.map(({ worstFetchStatus }) => worstFetchStatus)).toEqual(
      definitions.map(worstOf),
    );
  });

  it.each([
    ["no files", { definitions: {} }],
    ["no definitions", {}],
    ["definitions of null", { definitions: null }],
    ["a file with no fetch status", { definitions: { grant: { s3Key: "k" } } }],
    [
      "an unknown fetch status next to a good one",
      {
        definitions: {
          grant: { fetchStatus: FetchStatus.Fetched },
          agreement: { fetchStatus: "lost" },
        },
      },
    ],
  ])(
    "is null for a version with %s, so bad data never reads as Failed",
    async (_, fields) => {
      const [row] = await stamped([fields]);

      expect(row.worstFetchStatus).toBeNull();
    },
  );
});

describe("the writers of fetch status", () => {
  it("stamps an arriving version as not stored yet", async () => {
    await arrive("1.0.0", { agreementS3Key: "agreement.json" });

    expect((await versionOf("1.0.0")).worstFetchStatus).toBe(
      FetchStatus.Pending,
    );
  });

  it("keeps the worst when a repeated arrival adds a file location", async () => {
    await arrive("1.0.0");
    await record("1.0.0", "grant", FetchStatus.PermanentError, "invalid");

    await arrive("1.0.0", { paymentS3Key: "payment.json" });

    const doc = await versionOf("1.0.0");
    expect(doc.definitions.payment.fetchStatus).toBe(FetchStatus.Pending);
    expect(doc.worstFetchStatus).toBe(FetchStatus.PermanentError);
  });

  it("lowers a stored version to not stored yet when a repeated arrival adds a file", async () => {
    await arrive("1.0.0");
    await record("1.0.0", "grant", FetchStatus.Fetched);
    expect((await versionOf("1.0.0")).worstFetchStatus).toBe(
      FetchStatus.Fetched,
    );

    await arrive("1.0.0", { agreementS3Key: "agreement.json" });

    expect((await versionOf("1.0.0")).worstFetchStatus).toBe(
      FetchStatus.Pending,
    );
  });

  it.each(TYPES)(
    "follows a lazy fetch of the %s file through failure and success",
    async (type) => {
      await arrive("1.0.0", {
        agreementS3Key: "agreement.json",
        paymentS3Key: "payment.json",
      });
      await Promise.all(
        TYPES.filter((other) => other !== type).map((other) =>
          record("1.0.0", other, FetchStatus.Fetched),
        ),
      );

      await record("1.0.0", type, FetchStatus.TransientError, "timeout");
      await record("1.0.0", type, FetchStatus.TransientError, "$timeout");
      const retrying = await versionOf("1.0.0");
      expect(retrying.worstFetchStatus).toBe(FetchStatus.TransientError);
      expect(retrying.definitions[type]).toMatchObject({
        fetchStatus: FetchStatus.TransientError,
        fetchAttempts: 2,
        fetchError: "$timeout",
      });

      await record("1.0.0", type, FetchStatus.Fetched);
      const stored = await versionOf("1.0.0");
      expect(stored.worstFetchStatus).toBe(FetchStatus.Fetched);
      expect(stored.definitions[type]).toMatchObject({
        fetchStatus: FetchStatus.Fetched,
        fetchAttempts: 0,
        fetchError: null,
      });
      expect(stored.definitions[type].fetchedAt).toEqual(expect.any(String));

      await record("1.0.0", type, FetchStatus.PermanentError, "invalid");
      const failed = await versionOf("1.0.0");
      expect(failed.worstFetchStatus).toBe(FetchStatus.PermanentError);
      expect(failed.definitions[type].fetchAttempts).toBe(1);
    },
  );

  it("counts failures of a file stored without an attempt count", async () => {
    await configVersions.insertOne({
      grantCode: "woodland",
      version: "1.0.0",
      definitions: { grant: { fetchStatus: FetchStatus.Pending } },
    });

    await record("1.0.0", "grant", FetchStatus.TransientError, "timeout");

    expect((await versionOf("1.0.0")).definitions.grant.fetchAttempts).toBe(1);
  });
});

describe("every writer of config versions", () => {
  const writers = {
    upsert: () => arrive("1.0.0", { agreementS3Key: "agreement.json" }),
    updateFetchStatus: () =>
      updateFetchStatus("woodland", "1.0.0", FetchStatus.TransientError, "x"),
    updateDefinitionFetchStatus: () =>
      record("1.0.0", "agreement", FetchStatus.TransientError, "x"),
  };

  it("is listed here, so each one is checked for the worst fetch status", () => {
    const exportedWriters = [catalogRepository, configVersionRepository]
      .flatMap(Object.entries)
      .filter(
        ([name, value]) =>
          typeof value === "function" && !name.startsWith("find"),
      )
      .map(([name]) => name);

    expect(exportedWriters.sort()).toEqual(Object.keys(writers).sort());
  });

  it.each(Object.keys(writers))(
    "%s restamps the worst fetch status",
    async (name) => {
      await configVersions.insertOne({
        grantCode: "woodland",
        version: "1.0.0",
        status: "active",
        definitions: {
          grant: { s3Key: "grant.json", fetchStatus: FetchStatus.Fetched },
          agreement: {
            s3Key: "agreement.json",
            fetchStatus: FetchStatus.Fetched,
          },
        },
        worstFetchStatus: "stale",
      });

      await writers[name]();

      const { definitions, worstFetchStatus } = await versionOf("1.0.0");
      expect(worstFetchStatus).toBe(worstOf(definitions));
    },
  );
});
