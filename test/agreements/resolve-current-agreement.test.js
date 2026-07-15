import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const agreementNumber = "PMF823153883";
const code = "pigs-might-fly";
const clientRef = "xnp-rr3-nfa";
const sbi = "300000069";
const agreementId = "agreement-id";

const toItem = (status) => ({
  agreementItemId: "item-id",
  agreementCode: code,
  clientRef,
  sourceSystem: "GAS",
  configVersion: "0.0.1",
  identifiers: { sbi },
  payload: {},
  createdAt: "2026-07-14T12:00:00.000Z",
  status,
});

const toAgreement = (status = "offered") => ({
  _id: agreementId,
  agreementNumber,
  code,
  identifiers: { sbi },
  items: [toItem(status)],
  createdAt: "2026-07-14T12:00:00.000Z",
  updatedAt: "2026-07-14T12:00:00.000Z",
});

const toVersion = (version, status) => ({
  _id: `version-${version}`,
  agreementId,
  agreementNumber,
  version,
  snapshot: toAgreement(status),
  createdAt: `2026-07-14T12:0${version}:00.000Z`,
});

describe("Current Agreement resolution", () => {
  let client;
  let database;
  let mongoServer;
  let resolveCurrentAgreementByIdentity;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    vi.stubEnv("MONGO_URI", mongoServer.getUri());
    vi.stubEnv("MONGO_DATABASE", "current-agreement-test");
    ({ resolveCurrentAgreementByIdentity } =
      await import("../../src/agreements/use-cases/resolve-current-agreement.use-case.js"));
    client = await MongoClient.connect(process.env.MONGO_URI);
    database = client.db(process.env.MONGO_DATABASE);
  });

  beforeEach(async () => {
    await Promise.all([
      database.collection("agreements__agreements").deleteMany({}),
      database.collection("agreements__versions").deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await client?.close();
    await mongoServer?.stop();
    vi.unstubAllEnvs();
  });

  const seedAgreement = async ({
    agreement = toAgreement(),
    versions = [toVersion(1, "offered"), toVersion(2, "accepted")],
  } = {}) => {
    await database.collection("agreements__agreements").insertOne(agreement);

    if (versions.length > 0) {
      await database.collection("agreements__versions").insertMany(versions);
    }
  };

  it("returns the latest Agreement version and matching item", async () => {
    await seedAgreement();

    const result = await resolveCurrentAgreementByIdentity({
      code,
      clientRef,
      sbi,
    });

    expect(result.identity).toEqual({ agreementNumber, code, clientRef, sbi });
    expect(result.version.version).toBe(2);
    expect(result.item.status).toBe("accepted");
    expect(result).not.toHaveProperty("agreement");
    expect(result).not.toHaveProperty("definition");
  });

  it("returns a non-disclosing 404 when Agreement Identity does not match", async () => {
    await expect(
      resolveCurrentAgreementByIdentity({ code, clientRef, sbi }),
    ).rejects.toMatchObject({
      output: {
        statusCode: 404,
        payload: { message: "Agreement not found" },
      },
    });
  });

  it.each([
    ["code", { code: "wrong-code" }],
    ["client reference", { clientRef: "wrong-client" }],
    ["SBI", { sbi: "999999999" }],
  ])(
    "returns the same non-disclosing 404 for a wrong %s",
    async (_name, override) => {
      await seedAgreement();

      await expect(
        resolveCurrentAgreementByIdentity({
          code,
          clientRef,
          sbi,
          ...override,
        }),
      ).rejects.toMatchObject({
        output: {
          statusCode: 404,
          payload: { message: "Agreement not found" },
        },
      });
    },
  );

  it("returns a non-disclosing 404 when the root Agreement code is inconsistent", async () => {
    await seedAgreement({
      agreement: { ...toAgreement(), code: "wrong-code" },
    });

    await expect(
      resolveCurrentAgreementByIdentity({ code, clientRef, sbi }),
    ).rejects.toMatchObject({
      output: {
        statusCode: 404,
        payload: { message: "Agreement not found" },
      },
    });
  });

  it("returns 500 when the Agreement has no recorded version", async () => {
    await seedAgreement({ versions: [] });

    await expect(
      resolveCurrentAgreementByIdentity({ code, clientRef, sbi }),
    ).rejects.toMatchObject({ output: { statusCode: 500 } });
  });

  it.each([
    ["agreement number", { agreementNumber: "PMF000000000" }],
    ["code", { code: "wrong-code" }],
    ["SBI", { identifiers: { sbi: "999999999" } }],
    ["item", { items: [{ ...toItem("offered"), clientRef: "other" }] }],
  ])(
    "returns 500 when the latest snapshot has an inconsistent %s",
    async (_name, snapshotOverride) => {
      const version = toVersion(1, "offered");
      version.snapshot = { ...version.snapshot, ...snapshotOverride };
      await seedAgreement({ versions: [version] });

      await expect(
        resolveCurrentAgreementByIdentity({ code, clientRef, sbi }),
      ).rejects.toMatchObject({ output: { statusCode: 500 } });
    },
  );
});
