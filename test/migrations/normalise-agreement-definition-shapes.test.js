import { MongoClient, ObjectId } from "mongodb";
import { readFileSync } from "node:fs";
import { env } from "node:process";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { up as normaliseAgreementDefinitionShapes } from "../../migrations/20261026100000-normalise-agreement-definition-shapes.js";
import { checkAgreementDefinition } from "../../src/agreements/use-cases/compile-agreement-definition.js";
import { logger } from "../../src/common/logger.js";
import { pmfAgreementDefinitionFixture } from "../fixtures/pmf-agreement-definition.js";

const readFixture = (version) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../fixtures/pmf-agreement-definition-${version}.json`,
        import.meta.url,
      ),
    ),
  );

const validationPageShape = () => readFixture("3.11.1");
const paymentInputShape = () => readFixture("3.14.1");

let client;
let definitions;
let configVersions;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  definitions = client.db().collection("agreements__definitions");
  configVersions = client.db().collection("config_versions");
});

afterAll(async () => {
  await client?.close();
});

beforeEach(() => {
  vi.stubEnv("GRANT_FUNDING_CALCULATOR_URL", "http://localhost:3001");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const storeDefinition = (version, definition) =>
  definitions.insertOne({
    _id: new ObjectId(),
    code: "pigs-might-fly",
    version,
    definition,
  });

const storedDefinition = async (version) =>
  (await definitions.findOne({ code: "pigs-might-fly", version })).definition;

const storeConfigVersion = (version, agreement) =>
  configVersions.insertOne({
    grantCode: "pigs-might-fly",
    version,
    definitions: {
      agreement: {
        s3Key: `pigs-might-fly/${version}/gas/agreement.json`,
        fetchAttempts: 1,
        fetchedAt: null,
        lastFetchAttemptAt: "2026-09-01T10:00:00.000Z",
        ...agreement,
      },
    },
  });

const agreementState = async (version) =>
  (await configVersions.findOne({ grantCode: "pigs-might-fly", version }))
    .definitions.agreement;

const unusable = (fetchError) => ({
  fetchStatus: "permanent_error",
  fetchError,
});

const check = (version, definition) => () =>
  checkAgreementDefinition(definition, "pigs-might-fly", version);

const migrate = () => normaliseAgreementDefinitionShapes(client.db());

describe("normalising stored agreement definition shapes", () => {
  it("moves a validation page onto its action and drops the payment input", async () => {
    expect(check("3.11.1", validationPageShape())).toThrow(
      /"Validation" missing required peer "page"/,
    );
    await storeDefinition("3.11.1", validationPageShape());
    const info = vi.spyOn(logger, "info");

    await migrate();

    const expected = validationPageShape();
    const accept = expected.states.offered.on.accept;
    accept.page = accept.validation.page;
    delete accept.validation.page;
    delete expected.processDefinitions.CREATE_AGREEMENT_PAYMENT.input;
    const definition = await storedDefinition("3.11.1");
    expect(definition).toEqual(expected);
    expect(check("3.11.1", definition)).not.toThrow();
    expect(info).toHaveBeenCalledWith(
      "Normalised 1 agreement definitions: moved 1 validation pages onto their actions, dropped 1 payment inputs, left 0 with a conflicting page",
    );
    expect(info).toHaveBeenCalledWith(
      "0 stored agreement definitions still fail their checks, reset 0 permanent_error agreement versions to fetched",
    );
  });

  it("drops the payment input from a definition that already has action pages", async () => {
    expect(check("3.14.1", paymentInputShape())).toThrow(
      'Agreement Process mapping field "CREATE_AGREEMENT_PAYMENT.input.payment" is unknown',
    );
    await storeDefinition("3.14.1", paymentInputShape());

    await migrate();

    const expected = paymentInputShape();
    delete expected.processDefinitions.CREATE_AGREEMENT_PAYMENT.input;
    const definition = await storedDefinition("3.14.1");
    expect(definition).toEqual(expected);
    expect(check("3.14.1", definition)).not.toThrow();
  });

  it("keeps other handler input beside the payment", async () => {
    const stored = paymentInputShape();
    stored.processDefinitions.CREATE_AGREEMENT_PAYMENT.input.note = "kept";
    await storeDefinition("3.14.1", stored);

    await migrate();

    expect(
      (await storedDefinition("3.14.1")).processDefinitions
        .CREATE_AGREEMENT_PAYMENT,
    ).toEqual({ type: "handler", input: { note: "kept" } });
  });

  it("leaves a definition whose validation page disagrees with its action page as stored and counts it", async () => {
    const conflicting = validationPageShape();
    conflicting.states.offered.on.accept.page = "review";
    await storeDefinition("3.11.1", conflicting);
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect(await storedDefinition("3.11.1")).toEqual(conflicting);
    expect(info).toHaveBeenCalledWith(
      "Normalised 0 agreement definitions: moved 0 validation pages onto their actions, dropped 0 payment inputs, left 1 with a conflicting page",
    );
    expect(info).toHaveBeenCalledWith(
      "1 stored agreement definitions still fail their checks, reset 0 permanent_error agreement versions to fetched",
    );
  });

  it("leaves a definition already in the current shape exactly as it is", async () => {
    await storeDefinition("3.29.0", pmfAgreementDefinitionFixture);
    const before = await definitions.find({}).toArray();
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect(await definitions.find({}).toArray()).toEqual(before);
    expect(info).toHaveBeenCalledWith(
      "Normalised 0 agreement definitions: moved 0 validation pages onto their actions, dropped 0 payment inputs, left 0 with a conflicting page",
    );
  });

  it("marks a permanent_error version fetched only when its stored definition now passes", async () => {
    const conflicting = validationPageShape();
    conflicting.states.offered.on.accept.page = "review";
    await storeDefinition("3.11.1", validationPageShape());
    await storeDefinition("3.12.0", conflicting);
    await storeDefinition("3.14.1", paymentInputShape());
    await storeConfigVersion("3.11.1", unusable("missing required peer"));
    await storeConfigVersion("3.12.0", unusable("missing required peer"));
    await storeConfigVersion("3.13.0", unusable("not found"));
    await storeConfigVersion("3.14.1", {
      fetchStatus: "transient_error",
      fetchError: "timed out",
    });
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect(await agreementState("3.11.1")).toEqual({
      s3Key: "pigs-might-fly/3.11.1/gas/agreement.json",
      fetchStatus: "fetched",
      fetchError: null,
      fetchAttempts: 0,
      fetchedAt: expect.any(String),
      lastFetchAttemptAt: expect.any(String),
    });
    expect(await agreementState("3.12.0")).toMatchObject(
      unusable("missing required peer"),
    );
    expect(await agreementState("3.13.0")).toMatchObject(unusable("not found"));
    expect(await agreementState("3.14.1")).toMatchObject({
      fetchStatus: "transient_error",
      fetchError: "timed out",
    });
    expect(info).toHaveBeenCalledWith(
      "1 stored agreement definitions still fail their checks, reset 1 permanent_error agreement versions to fetched",
    );
  });

  it("recomputes the worst fetch status of a version it marks fetched", async () => {
    await storeDefinition("3.11.1", validationPageShape());
    await storeDefinition("3.14.1", paymentInputShape());
    await configVersions.insertMany([
      {
        grantCode: "pigs-might-fly",
        version: "3.11.1",
        worstFetchStatus: "permanent_error",
        definitions: {
          grant: { fetchStatus: "fetched" },
          agreement: unusable("missing required peer"),
        },
      },
      {
        grantCode: "pigs-might-fly",
        version: "3.14.1",
        worstFetchStatus: "permanent_error",
        definitions: {
          grant: { fetchStatus: "pending" },
          agreement: unusable("unknown input"),
        },
      },
    ]);

    await migrate();

    const worstOf = async (version) =>
      (await configVersions.findOne({ grantCode: "pigs-might-fly", version }))
        .worstFetchStatus;
    expect(await worstOf("3.11.1")).toBe("fetched");
    expect(await worstOf("3.14.1")).toBe("pending");
  });

  it("marks a fixed permanent_error version fetched when its service URL is missing, and says which", async () => {
    await storeDefinition("3.14.1", paymentInputShape());
    await storeConfigVersion("3.14.1", unusable("unknown input"));
    vi.stubEnv("GRANT_FUNDING_CALCULATOR_URL", undefined);
    const info = vi.spyOn(logger, "info");
    const warn = vi.spyOn(logger, "warn");

    await migrate();

    expect(await agreementState("3.14.1")).toMatchObject({
      fetchStatus: "fetched",
      fetchError: null,
    });
    expect(info).toHaveBeenCalledWith(
      "0 stored agreement definitions still fail their checks, reset 1 permanent_error agreement versions to fetched",
    );
    expect(warn).toHaveBeenCalledWith(
      "1 stored agreement definitions were not checked against their endpoint services, missing GRANT_FUNDING_CALCULATOR_URL",
    );
  });

  it("keeps a broken permanent_error version unusable when its service URL is missing", async () => {
    const stored = paymentInputShape();
    stored.processDefinitions.CREATE_AGREEMENT_PAYMENT.input.note = "unknown";
    await storeDefinition("3.14.1", stored);
    await storeConfigVersion("3.14.1", unusable("unknown input"));
    vi.stubEnv("GRANT_FUNDING_CALCULATOR_URL", undefined);
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect(await agreementState("3.14.1")).toMatchObject(
      unusable("unknown input"),
    );
    expect(info).toHaveBeenCalledWith(
      "1 stored agreement definitions still fail their checks, reset 0 permanent_error agreement versions to fetched",
    );
  });

  it("changes nothing when run again", async () => {
    await storeDefinition("3.11.1", validationPageShape());
    await storeDefinition("3.14.1", paymentInputShape());
    await storeConfigVersion("3.11.1", unusable("missing required peer"));
    await migrate();
    const definitionsAfterFirstRun = await definitions.find({}).toArray();
    const versionsAfterFirstRun = await configVersions.find({}).toArray();
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect(await definitions.find({}).toArray()).toEqual(
      definitionsAfterFirstRun,
    );
    expect(await configVersions.find({}).toArray()).toEqual(
      versionsAfterFirstRun,
    );
    expect(info).toHaveBeenCalledWith(
      "Normalised 0 agreement definitions: moved 0 validation pages onto their actions, dropped 0 payment inputs, left 0 with a conflicting page",
    );
    expect(info).toHaveBeenCalledWith(
      "0 stored agreement definitions still fail their checks, reset 0 permanent_error agreement versions to fetched",
    );
  });
});
