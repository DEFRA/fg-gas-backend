import { Collection } from "mongodb";
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

vi.mock("../../common/s3-client.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchConfigFile: vi.fn(),
}));
let replSet;
let db;
let mongoClient;
let catalogue;
let settings;
let lists;
let grants;
let ConfigVersion;
let FetchStatus;
let Grant;

const versionAt = (
  grantCode,
  version,
  status = "active",
  fetchStatus = FetchStatus.Fetched,
) => {
  const config = ConfigVersion.new({
    grantCode,
    version,
    status,
    s3Key: `${grantCode}/${version}/gas.json`,
    s3Bucket: "config",
  });
  config.fetchStatus = fetchStatus;
  return config.toDocument();
};
const grantAt = (code, version) =>
  new Grant({
    code,
    version,
    metadata: { description: code, startDate: "2026-01-01" },
    actions: [],
    phases: [],
  });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "available-grants-test");
  vi.resetModules();
  ({ mongoClient, db } = await import("../../common/mongo-client.js"));
  await mongoClient.connect();
  catalogue = await import("./config-version.repository.js");
  settings = await import("./grant-settings.repository.js");
  lists = await import("./grant-allow-list.repository.js");
  grants = await import("./grant.repository.js");
  ({ ConfigVersion, FetchStatus } =
    await import("../models/config-version.js"));
  ({ Grant } = await import("../models/grant.js"));
});
beforeEach(async () => {
  await db.dropDatabase();
});
afterAll(async () => {
  await mongoClient?.close();
  await replSet?.stop();
  vi.unstubAllEnvs();
});

describe("available grant bulk reads", () => {
  it("selects the newest active version across majors, retaining broken current versions", async () => {
    await db
      .collection("config_versions")
      .insertMany([
        versionAt("woodland", "1.0.0"),
        versionAt("woodland", "2.0.0"),
        versionAt("woodland", "2.0.1", "active", FetchStatus.PermanentError),
        versionAt("woodland", "3.0.0", "draft"),
        versionAt("draft-only", "1.0.0", "draft"),
      ]);
    const versions = await catalogue.findLatestActiveForAll();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      grantCode: "woodland",
      version: "2.0.1",
      fetchStatus: FetchStatus.PermanentError,
    });
  });
});

describe("settings batch reads", () => {
  it("hydrates only requested settings and leaves absent settings absent", async () => {
    await db.collection("grant_settings").insertMany([
      { grantCode: "woodland", open: true },
      { grantCode: "other", open: false },
    ]);
    const found = await settings.findByGrantCodes(["woodland", "missing"]);
    expect(found.map((item) => item.toDocument())).toEqual([
      { grantCode: "woodland", open: true },
    ]);
    expect(await settings.findByGrantCodes([])).toEqual([]);
  });
});

describe("allowlist batch reads", () => {
  it("hydrates only requested lists and leaves absent lists unrestricted for the domain", async () => {
    await db.collection("allow_lists").insertMany([
      { grantCode: "woodland", global: { sbi: ["000000001"], crn: [] } },
      { grantCode: "other", global: { sbi: [], crn: [] } },
    ]);
    const found = await lists.findByGrantCodes(["woodland", "missing"]);
    expect(found.map((item) => item.toJSON())).toEqual([
      { grantCode: "woodland", global: { sbi: ["000000001"], crn: [] } },
    ]);
    expect(await lists.findByGrantCodes([])).toEqual([]);
  });
});

describe("stored grant batch reads", () => {
  it("loads exact code and version pairs without admitting other versions", async () => {
    await grants.save(grantAt("woodland", "1.0.0"));
    await grants.save(grantAt("woodland", "2.0.0"));
    await grants.save(grantAt("other", "1.0.0"));
    await grants.save(grantAt("other", "2.0.0"));
    const found = await grants.findByCodesAndVersions([
      { grantCode: "woodland", version: "2.0.0" },
      { grantCode: "other", version: "1.0.0" },
    ]);
    expect(
      found
        .map(({ code, version }) => ({ code, version }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    ).toEqual([
      { code: "other", version: "1.0.0" },
      { code: "woodland", version: "2.0.0" },
    ]);
    expect(await grants.findByCodesAndVersions([])).toEqual([]);
  });
});

describe("bulk read stored-state validation", () => {
  it("refuses malformed requested settings", async () => {
    await db
      .collection("grant_settings")
      .insertOne({ grantCode: "woodland", open: "yes" });
    await expect(settings.findByGrantCodes(["woodland"])).rejects.toMatchObject(
      {
        output: {
          statusCode: 500,
          payload: { errorCode: "MALFORMED_GRANT_SETTINGS" },
        },
      },
    );
  });
  it("refuses malformed requested allowlists", async () => {
    await db.collection("allow_lists").insertOne({
      grantCode: "woodland",
      global: { sbi: ["invalid"], crn: [] },
    });
    await expect(lists.findByGrantCodes(["woodland"])).rejects.toMatchObject({
      output: {
        statusCode: 500,
        payload: { errorCode: "MALFORMED_ALLOW_LIST" },
      },
    });
  });
  it("does not read storage for empty batch inputs", async () => {
    const reads = vi.spyOn(db, "collection");
    await expect(settings.findByGrantCodes([])).resolves.toEqual([]);
    await expect(lists.findByGrantCodes([])).resolves.toEqual([]);
    await expect(grants.findByCodesAndVersions([])).resolves.toEqual([]);
    expect(reads).not.toHaveBeenCalled();
  });
});

const applicant = { sbi: "000000001", caller: "grants-ui" };
const available = async (input = applicant) => {
  const { withRequestContext } =
    await import("../../common/get-request-context.js");
  const { getAvailableGrantsUseCase } =
    await import("../use-cases/get-available-grants.use-case.js");
  return withRequestContext({}, () => getAvailableGrantsUseCase(input));
};
const seedGrant = async (code = "woodland", options = {}) => {
  const { version, open, fetchStatus } = {
    version: "1.0.0",
    open: true,
    fetchStatus: FetchStatus.Fetched,
    ...options,
  };
  await db
    .collection("config_versions")
    .insertOne(versionAt(code, version, "active", fetchStatus));
  await grants.save(grantAt(code, version));
  await db
    .collection("grant_settings")
    .updateOne({ grantCode: code }, { $set: { open } }, { upsert: true });
};

describe("available grant decisions", () => {
  it("returns the code of an open unrestricted grant", async () => {
    await seedGrant();
    await expect(available()).resolves.toEqual({
      grants: [
        { code: "woodland", title: "woodland", description: "woodland" },
      ],
    });
  });
});

describe("available grant domain parity", () => {
  it("returns an empty array when there are no active candidates", async () => {
    await expect(available()).resolves.toEqual({ grants: [] });
  });
  it.each([true, false, null])(
    "matches the individual decision with settings open=%s",
    async (open) => {
      await seedGrant("woodland", { open: open ?? true });
      if (open === null) await db.collection("grant_settings").deleteMany({});
      const { withRequestContext } =
        await import("../../common/get-request-context.js");
      const { checkGrantAllowListUseCase } =
        await import("../use-cases/check-grant-allow-list.use-case.js");
      const individual = await withRequestContext({}, () =>
        checkGrantAllowListUseCase({
          ...applicant,
          crn: "0000000001",
          grantCode: "woodland",
        }),
      );
      expect(individual).toEqual({ allowed: open === true });
      expect(await available()).toEqual({
        grants:
          open === true
            ? [{ code: "woodland", title: "woodland", description: "woodland" }]
            : [],
      });
    },
  );
  it.each([
    [[], [], true, true],
    [["000000001"], [], true, true],
    [["000000002"], [], false, false],
    [[], ["0000000001"], true, true],
    [[], ["0000000002"], false, true],
    [["000000001"], ["0000000001"], true, true],
    [["000000001"], ["0000000002"], false, true],
    [["000000002"], ["0000000001"], false, false],
  ])(
    "uses SBI-only business access while individual access checks both restrictions: %j / %j",
    async (sbi, crn, allowed, businessAllowed) => {
      await seedGrant();
      await db
        .collection("allow_lists")
        .insertOne({ grantCode: "woodland", global: { sbi, crn } });
      const { withRequestContext } =
        await import("../../common/get-request-context.js");
      const { checkGrantAllowListUseCase } =
        await import("../use-cases/check-grant-allow-list.use-case.js");
      expect(
        await withRequestContext({}, () =>
          checkGrantAllowListUseCase({
            ...applicant,
            crn: "0000000001",
            grantCode: "woodland",
          }),
        ),
      ).toEqual({ allowed });
      expect(await available()).toEqual({
        grants: businessAllowed
          ? [{ code: "woodland", title: "woodland", description: "woodland" }]
          : [],
      });
    },
  );
  it("returns unique grants with display metadata in code order", async () => {
    await seedGrant("zebra");
    await seedGrant("apple", { version: "1.0.0" });
    await seedGrant("apple", { version: "2.0.0" });
    expect(await available()).toEqual({
      grants: [
        { code: "apple", title: "apple", description: "apple" },
        { code: "zebra", title: "zebra", description: "zebra" },
      ],
    });
  });
  it("reads current settings and restrictions on every request", async () => {
    await seedGrant();
    expect(await available()).toEqual({
      grants: [
        { code: "woodland", title: "woodland", description: "woodland" },
      ],
    });
    await db
      .collection("grant_settings")
      .updateOne({ grantCode: "woodland" }, { $set: { open: false } });
    expect(await available()).toEqual({ grants: [] });
    await db
      .collection("grant_settings")
      .updateOne({ grantCode: "woodland" }, { $set: { open: true } });
    await db.collection("allow_lists").insertOne({
      grantCode: "woodland",
      global: { sbi: ["000000002"], crn: [] },
    });
    expect(await available()).toEqual({ grants: [] });
  });
});

describe("available grant definition failures", () => {
  it("fails on a newly published broken major instead of returning old or partial grants", async () => {
    await seedGrant();
    await seedGrant("other");
    expect(await available()).toEqual({
      grants: [
        { code: "other", title: "other", description: "other" },
        { code: "woodland", title: "woodland", description: "woodland" },
      ],
    });
    await seedGrant("woodland", {
      version: "2.0.0",
      fetchStatus: FetchStatus.PermanentError,
    });
    await expect(available()).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
    const audits = await db
      .collection("outbox")
      .find({ "event.audit.entities.action": "GET_AVAILABLE_GRANTS" })
      .toArray();
    expect(audits.map(({ event }) => event.audit.status)).toEqual([
      "SUCCESS",
      "FAILURE",
    ]);
    expect(audits[1].event.audit).toMatchObject({
      accounts: { sbi: "000000001" },
      details: { caller: "grants-ui" },
    });
    expect(audits[1].event.audit.details).not.toHaveProperty("grantCodes");
  });
});

describe("available grant cold definitions", () => {
  it("fetches and stores a pending current definition, ignoring an older stored major", async () => {
    await seedGrant();
    await db
      .collection("config_versions")
      .insertOne(versionAt("woodland", "2.0.0", "active", FetchStatus.Pending));
    const { fetchConfigFile } = await import("../../common/s3-client.js");
    fetchConfigFile.mockResolvedValue({
      code: "woodland",
      metadata: {
        title: "New woodland grant",
        description: "New",
        startDate: "2026-01-01",
      },
      actions: [],
      phases: [],
    });
    expect(await available()).toEqual({
      grants: [
        { code: "woodland", title: "New woodland grant", description: "New" },
      ],
    });
    expect(await grants.findByCode("woodland", "2.0.0")).toMatchObject({
      version: "2.0.0",
      metadata: { description: "New" },
    });
    const current = await catalogue.findLatestActive("woodland");
    expect(current.fetchStatus).toBe(FetchStatus.Fetched);
  });
  it("fails the whole request on a transient definition fetch failure", async () => {
    await seedGrant("other");
    await seedGrant("woodland", { fetchStatus: FetchStatus.Pending });
    const { fetchConfigFile, S3FetchError } =
      await import("../../common/s3-client.js");
    fetchConfigFile.mockRejectedValue(
      new S3FetchError("Unavailable", { statusCode: 503 }),
    );
    await expect(available()).rejects.toMatchObject({
      output: { statusCode: 503 },
    });
    const current = await catalogue.findLatestActive("woodland");
    expect(current.fetchStatus).toBe(FetchStatus.TransientError);
  });
  it.each(["pending", "permanent_error"])(
    "does not load a closed %s definition",
    async (fetchStatus) => {
      await seedGrant("woodland", { open: false, fetchStatus });
      expect(await available()).toEqual({ grants: [] });
    },
  );
  it("refuses malformed required state rather than returning partial grants", async () => {
    await seedGrant();
    await seedGrant("other");
    await db
      .collection("allow_lists")
      .insertOne({ grantCode: "woodland", global: { sbi: ["bad"], crn: [] } });
    await expect(available()).rejects.toMatchObject({
      output: { statusCode: 500 },
    });
  });
});

describe("available grant storage and performance", () => {
  it("uses four batch reads for warm decisions regardless of grant count", async () => {
    await seedGrant("apple");
    await seedGrant("woodland");
    await seedGrant("zebra");
    const reads = [];
    for (const method of ["find", "findOne", "aggregate"]) {
      const original = Collection.prototype[method];
      vi.spyOn(Collection.prototype, method).mockImplementation(function (
        ...args
      ) {
        if (
          [
            "config_versions",
            "grant_settings",
            "allow_lists",
            "grants",
          ].includes(this.collectionName)
        ) {
          reads.push({ collection: this.collectionName, method });
        }
        return original.apply(this, args);
      });
    }
    expect(await available()).toEqual({
      grants: [
        { code: "apple", title: "apple", description: "apple" },
        { code: "woodland", title: "woodland", description: "woodland" },
        { code: "zebra", title: "zebra", description: "zebra" },
      ],
    });
    expect(reads).toHaveLength(4);
    expect(reads.filter(({ method }) => method === "findOne")).toEqual([]);
  });
  it("propagates database failure and records a failure audit", async () => {
    vi.spyOn(Collection.prototype, "aggregate").mockImplementationOnce(() => {
      throw new Error("Database unavailable");
    });
    await expect(available()).rejects.toThrow("Database unavailable");
    const audits = await db
      .collection("outbox")
      .find({ "event.audit.entities.action": "GET_AVAILABLE_GRANTS" })
      .toArray();
    expect(audits).toHaveLength(1);
    expect(audits[0].event.audit.status).toBe("FAILURE");
  });
});
