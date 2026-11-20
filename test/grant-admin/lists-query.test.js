import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  aCwBucketAnswer,
  aCwCasesEntry,
  aCwEventRow,
} from "../helpers/cw-buckets.js";
import { cwStubRequests, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OPERATOR = { "x-actor": "Jo Operator", "x-actor-id": OID };

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

const anApplication = (n) => ({
  _id: new ObjectId(),
  clientRef: `app-${n}`,
  code: "woodland",
  currentPhase: "PRE_AWARD",
  currentStage: "REVIEW",
  currentStatus: "RECEIVED",
  createdAt: minute(n).toISOString(),
  identifiers: { sbi: "900000005" },
  refs: [`ref:app-${n}`, "sbi:900000005"],
});

const listQuery = (payload, headers = OPERATOR) =>
  wreck.post("/grant-admin/lists/query", { payload, headers });

const refusalOf = (promise) =>
  promise.then(
    () => null,
    (error) => ({
      statusCode: error.output.statusCode,
      ...error.data.payload,
    }),
  );

const ids = (shell) => shell.catalogue.buckets.map(({ id }) => id);

const bucketAudits = () =>
  outbox
    .find({
      eventType: "Audit",
      "event.audit.entities.action": "QUERY_BUCKET",
    })
    .toArray();

describe("POST /grant-admin/lists/query", () => {
  it("reads a GAS list by its path and URL params, with the catalogue beside it", async () => {
    await outbox.insertMany([
      aMessage(1, { status: "DEAD_LETTER" }),
      aMessage(2),
      aMessage(3, { status: "DEAD_LETTER" }),
    ]);

    const { payload } = await listQuery({
      path: "events/gas",
      params: {
        queue: "outbox",
        status: "DEAD_LETTER",
        range: "24h",
        page: "2",
      },
      search: null,
      count: true,
    });

    expect(payload.bucket).toBe("gas.events");
    expect(payload.list.rows.map(({ subtitle }) => subtitle)).toEqual([
      "evt-3",
      "evt-1",
    ]);
    expect(payload.list.pageRows).toEqual([2]);
    expect(payload.list.total).toEqual({ count: 2, capped: false });
    expect(payload.list.stopped).toBeNull();
    expect(payload.list.refusedSearch).toBeNull();
    expect(ids(payload.shell)).toContain("gas.events");
    expect(ids(payload.shell)).not.toContain("gas.outbox");
  });

  it("lists no box of a group on its own path", async () => {
    const refusal = await refusalOf(listQuery({ path: "events/gas/outbox" }));

    expect(refusal).toMatchObject({ statusCode: 404, code: "LIST_NOT_FOUND" });
  });

  it("reads pages 1 to N in one request, only the first counted", async () => {
    await outbox.insertMany(Array.from({ length: 25 }, (_, n) => aMessage(n)));

    const { payload } = await listQuery({
      path: "events/gas",
      params: {},
      pages: 3,
      count: true,
    });

    expect(payload.list.pageRows).toEqual([20, 5]);
    expect(new Set(payload.list.rows.map(({ id }) => id)).size).toBe(25);
    expect(payload.list.total).toEqual({ count: 25, capped: false });
    expect(payload.list.page.next).toBeNull();
  });

  it("audits every page it releases, each later one as a repeat", async () => {
    await applications.insertMany(
      Array.from({ length: 21 }, (_, n) => anApplication(n)),
    );

    const { payload } = await listQuery({
      path: "applications",
      params: { grant: "woodland" },
      pages: 2,
    });
    const audits = await bucketAudits();

    expect(payload.list.pageRows).toEqual([20, 1]);
    expect(
      audits.map(({ event }) => [
        event.audit.details.page,
        event.audit.details.repeat,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["first", false],
        ["next", true],
      ]),
    );
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain("app-");
  });

  it("reads a refused search's list again without it, and audits that read", async () => {
    await applications.insertMany([anApplication(1)]);

    const { payload } = await listQuery({
      path: "applications",
      params: {},
      search: "nokind:abc",
    });

    expect(payload.list.refusedSearch).toEqual({
      refusal:
        "The search names an identifier kind this bucket does not declare",
    });
    expect(payload.list.rows).toHaveLength(1);
    expect(await bucketAudits()).toHaveLength(1);
  });

  it("refuses an address it does not offer, naming its problems, with the catalogue", async () => {
    const refusal = await refusalOf(
      listQuery({
        path: "events/gas",
        params: {
          status: "BOGUS",
          errorname: ["A", "B"],
          colour: "x",
          queue: "elsewhere",
        },
        from: "not a time",
      }),
    );

    expect(refusal).toMatchObject({
      statusCode: 400,
      code: "ADDRESS_REFUSED",
      bucket: "gas.events",
      problems: {
        unknownKeys: ["colour"],
        repeatedKeys: ["errorname"],
        unknownValues: ["status", "queue"],
      },
    });
    expect(ids(refusal.shell)).toContain("gas.events");
    expect(JSON.stringify(refusal)).not.toContain("BOGUS");
  });

  it("refuses a range that is not one, without reading, when asked only to check", async () => {
    const refusal = await refusalOf(
      listQuery({
        path: "events/gas",
        from: "2026-06-16T11:00:00.000Z",
        to: "2026-06-16T10:00:00.000Z",
        read: false,
      }),
    );

    expect(refusal).toMatchObject({
      statusCode: 400,
      code: "RANGE_REFUSED",
      bucket: "gas.events",
    });
  });

  it("checks without reading", async () => {
    const { payload } = await listQuery({
      path: "events/gas",
      params: { status: "DEAD_LETTER" },
      read: false,
    });

    expect(payload.bucket).toBe("gas.events");
    expect(payload.list).toBeNull();
    expect(payload.shell).not.toBeNull();
  });

  it("answers 404 LIST_NOT_FOUND for a path no list has, echoing nothing", async () => {
    const { shell, ...refusal } = await refusalOf(
      listQuery({ path: "events/<b>x</b>" }),
    );

    expect(refusal).toEqual({
      statusCode: 404,
      error: "Not Found",
      message: "No list has this path",
      code: "LIST_NOT_FOUND",
    });
    expect(shell).toBeDefined();
  });

  // With ADMIN_SHELL_CACHE_MS at 0, each request reads Caseworking's lists
  // again, and the instance keeps the paths it last listed.
  const listedThenDown = async () => {
    await setCwStub({ buckets: { entries: [aCwCasesEntry()] } });
    await refusalOf(listQuery({ path: "events/gas/nothing" }));
    await setCwStub({ buckets: { mode: "down" } });
  };

  it("answers 503 CW_UNREACHABLE for a list Caseworking last listed while its catalogue cannot be read", async () => {
    await listedThenDown();

    const refusal = await refusalOf(listQuery({ path: "cases" }));

    expect(refusal).toMatchObject({ statusCode: 503, code: "CW_UNREACHABLE" });
    expect(refusal.shell.catalogue.sourceErrors).toEqual([{ hop: "CW-BE" }]);
  });

  it("answers 503 CW_UNREACHABLE for Caseworking's events while its catalogue cannot be read", async () => {
    await listedThenDown();

    const refusal = await refusalOf(listQuery({ path: "events/cw" }));

    expect(refusal).toMatchObject({ statusCode: 503, code: "CW_UNREACHABLE" });
  });

  it("answers 404 LIST_NOT_FOUND for a path neither service last listed while Caseworking's catalogue cannot be read", async () => {
    await listedThenDown();

    const refusal = await refusalOf(listQuery({ path: "events/gas/nothing" }));

    expect(refusal).toMatchObject({ statusCode: 404, code: "LIST_NOT_FOUND" });
    expect(refusal.shell.catalogue.sourceErrors).toEqual([{ hop: "CW-BE" }]);
  });

  it("forwards a Caseworking list by its id, with the operator, as its filters", async () => {
    const answer = aCwBucketAnswer("cases", [
      aCwEventRow("cases", {
        id: "665f1c2e9a1b2c3d4e5f0001",
        eventId: "cw-evt-1",
        type: "CreateCase",
        status: "COMPLETED",
        time: minute(2).toISOString(),
      }),
    ]);
    await setCwStub({
      buckets: {
        entries: [
          {
            ...aCwCasesEntry(),
            facts: [
              {
                name: "status",
                param: "status",
                label: "Status",
                values: [{ value: "COMPLETED", label: "Completed" }],
                within: null,
              },
            ],
          },
        ],
        answers: { "cw.cases": answer },
      },
    });

    const { payload } = await listQuery({
      path: "cases",
      params: { status: "COMPLETED" },
      repeat: true,
    });
    const forwarded = (await cwStubRequests()).find(
      ({ path }) => path === "/actuators/buckets/cw.cases/query",
    );

    expect(payload.bucket).toBe("cw.cases");
    expect(payload.list.rows).toEqual(answer.rows);
    expect(forwarded).toMatchObject({
      actor: "Jo Operator",
      searchRepeat: "1",
      body: { where: { status: "COMPLETED" }, limit: 20 },
    });
  });
});
