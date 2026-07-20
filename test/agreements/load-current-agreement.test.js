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

const toItem = (state) => ({
  agreementItemId: "item-id",
  agreementCode: code,
  clientRef,
  sourceSystem: "GAS",
  configVersion: "1.0.1",
  identifiers: { sbi },
  payload: {},
  createdAt: "2026-07-14T12:00:00.000Z",
  state,
});

const toAgreement = (state = "offered") => ({
  _id: agreementId,
  agreementNumber,
  code,
  identifiers: { sbi },
  items: [toItem(state)],
  createdAt: "2026-07-14T12:00:00.000Z",
  updatedAt: "2026-07-14T12:00:00.000Z",
});

const toVersion = (version, state) => ({
  _id: `version-${version}`,
  agreementId,
  agreementNumber,
  version,
  snapshot: toAgreement(state),
  createdAt: `2026-07-14T12:0${version}:00.000Z`,
});

describe("loadCurrentAgreement", () => {
  let client;
  let database;
  let mongoServer;
  let loadCurrentAgreement;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    vi.stubEnv("MONGO_URI", mongoServer.getUri());
    vi.stubEnv("MONGO_DATABASE", "current-agreement-test");
    ({ loadCurrentAgreement } =
      await import("../../src/agreements/use-cases/load-current-agreement.js"));
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

    const result = await loadCurrentAgreement({
      code,
      clientRef,
      sbi,
    });

    expect(result.reference).toEqual({
      agreementNumber,
      code,
      clientRef,
      sbi,
    });
    expect(result.version.version).toBe(2);
    expect(result.state).toBe("accepted");
    expect(result.item.state).toBe("accepted");
    expect(result).not.toHaveProperty("agreement");
    expect(result).not.toHaveProperty("definition");
  });

  it("returns a non-disclosing 404 when the Agreement Reference cannot be resolved", async () => {
    await expect(
      loadCurrentAgreement({ code, clientRef, sbi }),
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
        loadCurrentAgreement({
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

  it.each([
    ["code", { code: "wrong-code" }],
    [
      "item SBI",
      {
        items: [{ ...toItem("offered"), identifiers: { sbi: "999999999" } }],
      },
    ],
  ])(
    "returns a non-disclosing 404 when the root Agreement has an inconsistent %s",
    async (_name, agreementOverride) => {
      await seedAgreement({
        agreement: { ...toAgreement(), ...agreementOverride },
      });

      await expect(
        loadCurrentAgreement({ code, clientRef, sbi }),
      ).rejects.toMatchObject({
        output: {
          statusCode: 404,
          payload: { message: "Agreement not found" },
        },
      });
    },
  );

  it("returns 500 when the Agreement has no recorded version", async () => {
    await seedAgreement({ versions: [] });

    await expect(
      loadCurrentAgreement({ code, clientRef, sbi }),
    ).rejects.toMatchObject({ output: { statusCode: 500 } });
  });

  it.each([
    ["agreement number", { agreementNumber: "PMF000000000" }],
    ["code", { code: "wrong-code" }],
    ["SBI", { identifiers: { sbi: "999999999" } }],
    ["item", { items: [{ ...toItem("offered"), clientRef: "other" }] }],
    [
      "item SBI",
      {
        items: [{ ...toItem("offered"), identifiers: { sbi: "999999999" } }],
      },
    ],
  ])(
    "returns 500 when the latest snapshot has an inconsistent %s",
    async (_name, snapshotOverride) => {
      const version = toVersion(1, "offered");
      version.snapshot = { ...version.snapshot, ...snapshotOverride };
      await seedAgreement({ versions: [version] });

      await expect(
        loadCurrentAgreement({ code, clientRef, sbi }),
      ).rejects.toMatchObject({ output: { statusCode: 500 } });
    },
  );
});
