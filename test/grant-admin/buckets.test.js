import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  bucketCatalogueResponseSchema,
  bucketQueryResponseSchema,
} from "../../src/grant-admin/schemas/bucket.schema.js";
import {
  aCwBucketAnswer,
  aCwBucketEntry,
  aCwEventRow,
} from "../helpers/cw-buckets.js";
import { cwStubRequests, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OPERATOR = { "x-actor": "Jo Operator", "x-actor-id": OID };
const OTHER_SERVICE = "Bearer 22222222-2222-2222-2222-222222222222";

let client;
let applications;
let outbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db();
  applications = db.collection("applications");
  outbox = db.collection("outbox");
});

afterAll(async () => {
  await client?.close();
});

beforeEach(async () => {
  await resetCwStub();
});

const minute = (n) => new Date(Date.UTC(2026, 5, 16, 10, n));

const aMessage = (n, overrides = {}) => ({
  _id: new ObjectId(),
  target: "arn:aws:sns:eu-west-2:000000000000:create_new_case",
  segregationRef: `ref-${n}-woodland`,
  status: "COMPLETED",
  completionAttempts: 0,
  publicationDate: minute(n),
  claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  event: { id: `evt-${n}`, data: { caseRef: `ref-${n}` } },
  eventType: "CreateCase",
  refs: [`ref:ref-${n}`, `id:evt-${n}`],
  ...overrides,
});

const anApplication = (clientRef, overrides = {}) => ({
  _id: new ObjectId(),
  clientRef,
  code: "woodland",
  currentPhase: "PRE_AWARD",
  currentStage: "REVIEW",
  currentStatus: "RECEIVED",
  createdAt: minute(0).toISOString(),
  identifiers: { sbi: "900000005" },
  refs: [`ref:${clientRef}`, "sbi:900000005"],
  ...overrides,
});

const query = (bucketId, payload, headers = OPERATOR) =>
  wreck.post(`/grant-admin/buckets/${bucketId}/query`, { payload, headers });

const answerOf = async (bucketId, payload) =>
  (await query(bucketId, payload)).payload;

const refusalOf = (promise) =>
  promise.then(
    () => null,
    (error) => error.data.payload,
  );

const bucketAudits = () =>
  outbox
    .find({
      eventType: "Audit",
      "event.audit.entities.action": "QUERY_BUCKET",
    })
    .toArray();

describe("GET /grant-admin/buckets", () => {
  it("answers its own buckets and Caseworking's, in order", async () => {
    await setCwStub({
      buckets: { entries: [aCwBucketEntry("outbox"), aCwBucketEntry("inbox")] },
    });

    const { payload } = await wreck.get("/grant-admin/buckets");

    expect(
      bucketCatalogueResponseSchema.validate(payload).error,
    ).toBeUndefined();
    expect(payload.buckets.map(({ id }) => id)).toEqual([
      "gas.outbox",
      "gas.inbox",
      "cw.outbox",
      "cw.inbox",
      "gas.applications",
    ]);
    expect(payload.sourceErrors).toEqual([]);
  });

  it("answers its own buckets and names Caseworking when it is down", async () => {
    await setCwStub({ buckets: { mode: "down" } });

    const { payload } = await wreck.get("/grant-admin/buckets");

    expect(payload.buckets.map(({ id }) => id)).toEqual([
      "gas.outbox",
      "gas.inbox",
      "gas.applications",
    ]);
    expect(payload.sourceErrors).toEqual([{ hop: "CW-BE" }]);
  });

  it("lists the stored grants and statuses of the applications", async () => {
    await applications.insertOne(anApplication("ref-1"));

    const { payload } = await wreck.get("/grant-admin/buckets");
    const { facts } = payload.buckets.find(
      ({ id }) => id === "gas.applications",
    );

    expect(facts.find(({ name }) => name === "code").values).toEqual([
      { value: "woodland", label: "woodland" },
    ]);
  });

  it("describes the version of an application as a fact within its grant", async () => {
    const { payload } = await wreck.get("/grant-admin/buckets");
    const { facts, indexes } = payload.buckets.find(
      ({ id }) => id === "gas.applications",
    );

    expect(facts.find(({ name }) => name === "currentConfigVersion")).toEqual({
      name: "currentConfigVersion",
      param: "version",
      label: "Version",
      values: null,
      toggle: null,
      within: "code",
    });
    expect(indexes).toContainEqual(["code", "currentConfigVersion"]);
  });

  it("answers a Caseworking bucket whose facts say what they are within", async () => {
    const cases = {
      ...aCwBucketEntry("outbox"),
      facts: [
        {
          name: "workflowCode",
          param: "workflow",
          label: "Workflow",
          values: null,
          toggle: null,
          within: null,
        },
        {
          name: "currentConfigVersion",
          param: "version",
          label: "Version",
          values: null,
          toggle: null,
          within: "workflowCode",
        },
      ],
    };
    await setCwStub({ buckets: { entries: [cases] } });

    const { payload } = await wreck.get("/grant-admin/buckets");

    expect(payload.buckets.find(({ id }) => id === "cw.outbox").facts).toEqual(
      cases.facts,
    );
    expect(payload.sourceErrors).toEqual([]);
  });

  it("refuses another client with 403", async () => {
    await expect(
      wreck.get("/grant-admin/buckets", {
        headers: { authorization: OTHER_SERVICE },
      }),
    ).rejects.toMatchObject({ output: { statusCode: 403 } });
  });
});

describe("POST /grant-admin/buckets/{bucketId}/query", () => {
  it("pages the outbox newest first, with no row repeated or missed", async () => {
    await outbox.insertMany(Array.from({ length: 45 }, (_, n) => aMessage(n)));

    const first = await answerOf("gas.outbox", {});
    const second = await answerOf("gas.outbox", { cursor: first.page.next });
    const third = await answerOf("gas.outbox", { cursor: second.page.next });

    expect(bucketQueryResponseSchema.validate(first).error).toBeUndefined();
    expect(first.plan).toMatchObject({
      kind: "exact",
      index: ["eventType", "publicationDate", "_id"],
    });
    expect(
      [...first.rows, ...second.rows, ...third.rows].map((row) => row.subtitle),
    ).toEqual(Array.from({ length: 45 }, (_, n) => `evt-${44 - n}`));
    expect(third.page).toMatchObject({ next: null, complete: true });
  });

  it("filters, counts and groups on declared facts", async () => {
    await outbox.insertMany([
      aMessage(1, { status: "DEAD_LETTER" }),
      aMessage(2, { status: "DEAD_LETTER", eventType: "UpdateCaseStatus" }),
      aMessage(3),
    ]);

    const answer = await answerOf("gas.outbox", {
      where: { status: "DEAD_LETTER", eventType: "CreateCase" },
      groupBy: ["status"],
    });

    expect(answer.plan).toMatchObject({
      kind: "exact",
      bound: ["eventType", "status"],
      filled: [],
      scans: 1,
    });
    expect(answer.rows.map((row) => row.subtitle)).toEqual(["evt-1"]);
    expect(answer.groups[0].values.filter(({ count }) => count > 0)).toEqual([
      { value: "COMPLETED", count: 1, capped: false },
      { value: "DEAD_LETTER", count: 1, capped: false },
    ]);
  });

  it("finds a row by a ref, and lists audit rows only when they are asked for", async () => {
    await outbox.insertMany([
      aMessage(1),
      aMessage(2, { eventType: "Audit", refs: [] }),
    ]);

    const byRef = await answerOf("gas.outbox", { ref: "ref:REF-1" });
    const hiding = await answerOf("gas.outbox", {});
    const showing = await answerOf("gas.outbox", {
      show: ["eventType"],
    });
    const named = await answerOf("gas.outbox", {
      where: { eventType: "Audit" },
    });

    expect(byRef.plan.index).toEqual([
      "eventType",
      "refs",
      "publicationDate",
      "_id",
    ]);
    expect(byRef.rows.map((row) => row.subtitle)).toEqual(["evt-1"]);
    expect(hiding.plan).toMatchObject({ kind: "exact", filled: ["eventType"] });
    expect(hiding.rows.map((row) => row.subtitle)).toEqual(["evt-1"]);
    expect(showing.plan).toMatchObject({
      kind: "exact",
      filled: ["eventType"],
      scans: hiding.plan.scans + 1,
    });
    expect(showing.rows.map((row) => row.subtitle)).toEqual(["evt-2", "evt-1"]);
    expect(named.rows.map((row) => row.subtitle)).toEqual(["evt-2"]);
  });

  it("reads a fact with no index line inside a budget, and says so", async () => {
    await outbox.insertMany([
      aMessage(1, { lastError: { name: "TimeoutError" } }),
      aMessage(2, { lastError: { name: "OtherError" } }),
    ]);

    const answer = await answerOf("gas.outbox", {
      where: { "lastError.name": "TimeoutError" },
    });

    expect(answer.plan).toMatchObject({
      kind: "bounded",
      bound: [],
      residual: ["lastError.name"],
    });
    expect(answer.rows.map((row) => row.subtitle)).toEqual(["evt-1"]);
    expect(answer.page.complete).toBe(true);
  });

  it.each([
    ["an undeclared fact", { where: { colour: "x" } }, "UNKNOWN_FACT"],
    [
      "a payload path",
      { where: { "event.data.caseRef": "x" } },
      "UNKNOWN_FACT",
    ],
    ["free text", { q: "x" }, "INVALID_REQUEST"],
    ["an undeclared ref kind", { ref: "nokind:1" }, "UNKNOWN_REF_KIND"],
    ["an unreadable cursor", { cursor: "x" }, "INVALID_CURSOR"],
    ["an undeclared grouping", { groupBy: ["grantCode"] }, "UNKNOWN_GROUPING"],
    [
      "from after to",
      { from: "2026-06-17T00:00:00.000Z", to: "2026-06-16T00:00:00.000Z" },
      "INVALID_RANGE",
    ],
  ])("refuses %s with 400 and its reason", async (_, payload, reason) => {
    expect(await refusalOf(query("gas.outbox", payload))).toMatchObject({
      statusCode: 400,
      reason,
    });
  });

  it.each(["gas.nothing", "GAS.Outbox", "cw.nothing"])(
    "answers 404 UNKNOWN_BUCKET for %s",
    async (bucketId) => {
      expect(await refusalOf(query(bucketId, {}))).toMatchObject({
        statusCode: 404,
        reason: "UNKNOWN_BUCKET",
      });
    },
  );

  it("writes one audit row for a read of an audited bucket, naming facts and never values", async () => {
    await applications.insertOne(anApplication("ref-1"));

    const answer = await answerOf("gas.applications", {
      where: { code: "woodland" },
      ref: "sbi:900000005",
    });
    const [row, ...others] = await bucketAudits();

    expect(answer.rows.map((found) => found.title)).toEqual(["ref-1"]);
    expect(others).toEqual([]);
    expect(row).toMatchObject({ eventType: "Audit" });
    expect(row.event).toMatchObject({
      user: OID,
      audit: { entities: [{ entity: "BUCKET", entityid: "gas.applications" }] },
    });
    expect(row.event.audit.details).toMatchObject({
      facts: ["code"],
      refKind: "sbi",
      page: "first",
      plan: "bounded",
      resultCount: 1,
    });
    expect(JSON.stringify(row.event.audit.details)).not.toContain("900000005");
  });

  it("lists the applications on one version of a grant exactly, showing the version", async () => {
    await applications.insertMany([
      anApplication("ref-1", { currentConfigVersion: "1.2.0" }),
      anApplication("ref-2", { currentConfigVersion: "1.1.0" }),
      anApplication("ref-3", {
        code: "hedgerows",
        currentConfigVersion: "1.2.0",
      }),
    ]);

    const answer = await answerOf("gas.applications", {
      where: { code: "woodland", currentConfigVersion: "1.2.0" },
    });
    const [row] = await bucketAudits();

    expect(bucketQueryResponseSchema.validate(answer).error).toBeUndefined();
    expect(answer.plan).toMatchObject({
      kind: "exact",
      index: ["code", "currentConfigVersion", "createdAt", "_id"],
      bound: ["code", "currentConfigVersion"],
      residual: [],
    });
    expect(answer.rows.map(({ title, cells }) => [title, cells.code])).toEqual([
      ["ref-1", "woodland@1.2.0"],
    ]);
    expect(answer.rows[0].link).toMatchObject({ code: "woodland" });
    expect(row.event.audit.details.facts).toEqual([
      "code",
      "currentConfigVersion",
    ]);
    expect(JSON.stringify(row.event.audit.details)).not.toContain("1.2.0");
  });

  it("writes no audit row for the outbox, or for a refused request", async () => {
    await answerOf("gas.outbox", {});
    await refusalOf(query("gas.applications", { where: { colour: "x" } }));

    expect(await bucketAudits()).toEqual([]);
  });

  it("forwards a Caseworking bucket by its id and answers its body, writing no audit", async () => {
    const answer = aCwBucketAnswer("inbox", [
      aCwEventRow("inbox", {
        id: "665f1c2e9a1b2c3d4e5f0001",
        eventId: "cw-evt-1",
        type: "CreateCase",
        status: "COMPLETED",
        time: minute(2).toISOString(),
      }),
    ]);
    await setCwStub({ buckets: { answers: { "cw.inbox": answer } } });

    const { payload } = await query(
      "cw.inbox",
      { where: { status: "COMPLETED" } },
      { ...OPERATOR, "x-search-repeat": "1" },
    );
    const [forwarded] = await cwStubRequests();

    expect(payload).toEqual(answer);
    expect(forwarded).toMatchObject({
      path: "/actuators/buckets/cw.inbox/query",
      actor: "Jo Operator",
      actorId: OID,
      searchRepeat: "1",
      body: { where: { status: "COMPLETED" }, limit: 20 },
    });
    expect(await bucketAudits()).toEqual([]);
  });

  it("rebuilds Caseworking's refusal from its reason, never its message", async () => {
    await setCwStub({ buckets: { refusal: "UNKNOWN_FACT" } });

    const refusal = await refusalOf(query("cw.inbox", {}));

    expect(refusal).toEqual({
      statusCode: 400,
      error: "Bad Request",
      message: "A filter names a fact this bucket does not declare",
      reason: "UNKNOWN_FACT",
    });
  });

  it("answers 502 when Caseworking is down", async () => {
    await setCwStub({ buckets: { mode: "down" } });

    expect(await refusalOf(query("cw.inbox", {}))).toMatchObject({
      statusCode: 502,
    });
  });

  it("refuses another client with 403", async () => {
    await expect(
      query("gas.outbox", {}, { ...OPERATOR, authorization: OTHER_SERVICE }),
    ).rejects.toMatchObject({ output: { statusCode: 403 } });
  });
});
