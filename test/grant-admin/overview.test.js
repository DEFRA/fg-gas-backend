import { MongoClient, ObjectId } from "mongodb";
import { createHash, randomBytes } from "node:crypto";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withWorstFetchStatus } from "../../src/common/config-broker/config-catalog.repository.js";
import { overviewResponseSchema } from "../../src/grant-admin/schemas/overview.schema.js";
import { aCwBucketAnswer, aCwBucketEntry } from "../helpers/cw-buckets.js";
import { cwStubRequests, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OPERATOR = { "x-actor": "Jo Operator", "x-actor-id": OID };
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const FIXTURE = "overview-fixture";

let client;
let outbox;
let inbox;
let configVersions;
let accessTokens;

const now = Date.now();
const hoursAgo = (hours) => new Date(now - hours * HOUR);

const anOutboxRow = (hours, overrides = {}) => ({
  _id: new ObjectId(),
  target: "arn:aws:sns:eu-west-2:000000000000:create_new_case",
  segregationRef: FIXTURE,
  status: "DEAD_LETTER",
  completionAttempts: 5,
  publicationDate: hoursAgo(hours),
  claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  event: { id: "evt-1", data: {} },
  eventType: "CreateCase",
  errorKey: "Grant <v> not found",
  ...overrides,
});

const anInboxRow = (hours, overrides = {}) => ({
  _id: new ObjectId(),
  source: "CW",
  segregationRef: FIXTURE,
  status: "DEAD_LETTER",
  publicationDate: hoursAgo(hours).toISOString(),
  claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  messageId: "0b7c1d1e-0000-4000-8000-000000000001",
  event: { data: {} },
  eventType: "CaseStatusUpdated",
  errorKey: "No error recorded",
  ...overrides,
});

const aConfigVersion = (version, fetchStatus) => ({
  _id: new ObjectId(),
  grantCode: "overview-grant",
  version,
  status: "active",
  receivedAt: hoursAgo(1).toISOString(),
  definitions: { grant: { fetchStatus } },
  itFixture: FIXTURE,
});

const hashOf = (raw) => createHash("sha256").update(raw, "utf8").digest("hex");

const aToken = (clientId, expiresAt) => ({
  id: hashOf(randomBytes(32).toString("base64url")),
  clientId,
  tokenHint: "ab12",
  createdAt: hoursAgo(DAY / HOUR),
  createdBy: "Ada Lovelace",
  expiresAt,
  itFixture: true,
});

const cwBins = () =>
  Array.from({ length: 12 }, () => ({ count: 0, capped: false }));

const withEdges = (from, bins) =>
  bins.map((bin, i) => ({
    from: new Date(Date.parse(from) + i * 2 * HOUR).toISOString(),
    to: new Date(Date.parse(from) + (i + 1) * 2 * HOUR).toISOString(),
    ...bin,
  }));

const cwEntry = (box) => ({
  ...aCwBucketEntry(box),
  facts: [
    {
      name: "status",
      param: "status",
      label: "Status",
      values: [],
      toggle: null,
    },
    {
      name: "eventType",
      param: "event",
      label: "Event",
      values: [{ value: "UpdateCaseStatus", label: "Update case status" }],
      toggle: null,
    },
    {
      name: "errorKey",
      param: "error",
      label: "Error",
      values: null,
      toggle: null,
    },
  ],
  summaries: [
    {
      id: "errors",
      label: "Top errors",
      by: ["errorKey", "eventType"],
      among: { status: "DEAD_LETTER" },
      top: 20,
      none: "No error recorded",
    },
  ],
});

const cwSummary = (bucket, entries) => ({
  bucket,
  summary: "errors",
  entries,
  more: false,
  complete: true,
});

const readOverview = async () =>
  (
    await wreck.get("/grant-admin/overview", {
      headers: OPERATOR,
      timeout: 10_000,
    })
  ).payload;

const cwPaths = async () =>
  (await cwStubRequests()).map(({ method, path }) => `${method} ${path}`);

// The reads the answer keeps: the tokens are read for every request.
const keptPaths = async () =>
  (await cwPaths()).filter((path) => path !== "GET /actuators/clients");

// Each test starts on emptied event and version collections (test/cleanup.js).
const seed = async () => {
  await outbox.insertMany([
    anOutboxRow(1),
    anOutboxRow(1.5),
    anOutboxRow(5),
    anOutboxRow(2, { status: "COMPLETED" }),
    anOutboxRow(2, { eventType: "Audit" }),
    anOutboxRow(25),
  ]);
  await inbox.insertMany([anInboxRow(3)]);
  await configVersions.insertMany([
    aConfigVersion("1.0.0", "permanent_error"),
    aConfigVersion("1.1.0", "transient_error"),
    aConfigVersion("1.2.0", "pending"),
  ]);
  await configVersions.updateMany({ itFixture: FIXTURE }, [
    withWorstFetchStatus,
  ]);
  await accessTokens.insertMany([
    aToken("it-overview-soon", new Date(now + 3 * DAY)),
    aToken("it-overview-later", new Date(now + 90 * DAY)),
  ]);
};

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db();
  outbox = db.collection("outbox");
  inbox = db.collection("inbox");
  configVersions = db.collection("config_versions");
  accessTokens = db.collection("access_tokens");
});

afterAll(async () => {
  await accessTokens.deleteMany({ itFixture: true });
  await client?.close();
});

// One GAS keeps its answer for 60 seconds, so these run in order on one cache.
describe("GET /grant-admin/overview", () => {
  let first;

  it("answers both services' parts, each read on its own, a Caseworking that fails one saying so", async () => {
    await seed();
    await resetCwStub();
    await setCwStub({
      buckets: {
        deadLettersStatus: 500,
        entries: [cwEntry("outbox"), cwEntry("inbox")],
        summaries: {
          "cw.outbox": cwSummary("cw.outbox", []),
          "cw.inbox": cwSummary("cw.inbox", [
            {
              values: {
                errorKey: "Status <v> unknown",
                eventType: "UpdateCaseStatus",
              },
              count: 4,
              capped: false,
              firstAt: hoursAgo(3).toISOString(),
              lastAt: hoursAgo(1).toISOString(),
            },
          ]),
        },
        answers: { "cw.workflows": aCwBucketAnswer("workflows", []) },
      },
      clients: {
        list: {
          tokens: [
            {
              tokenId: "6650c1f2a9e4b1d07c20bd91",
              clientId: "fg-gas-backend",
              tokenHint: "ab12",
              status: "EXPIRED",
              createdAt: "2026-01-01T00:00:00.000Z",
              createdBy: "Ada Lovelace",
              expiresAt: "2026-02-01T00:00:00.000Z",
              revokedAt: null,
              revokedBy: null,
              inUse: false,
              stored: {
                _id: { $oid: "6650c1f2a9e4b1d07c20bd91" },
                id: "abc••••••def",
              },
            },
          ],
        },
      },
    });

    first = await readOverview();

    expect(overviewResponseSchema.validate(first).error).toBeUndefined();
    expect(Date.parse(first.window.to) - Date.parse(first.window.from)).toBe(
      DAY,
    );

    // The audit dead letter too: the Overview counts as the list does.
    expect(first.deadLetters.gas.data).toMatchObject({
      count: 5,
      capped: false,
      lists: [
        {
          box: "outbox",
          count: 4,
          capped: false,
          list: {
            path: "events/gas/outbox",
            query: { status: "DEAD_LETTER", ...first.window },
          },
        },
        {
          box: "inbox",
          count: 1,
          capped: false,
          list: {
            path: "events/gas/inbox",
            query: { status: "DEAD_LETTER", ...first.window },
          },
        },
      ],
    });
    expect(first.deadLetters.gas.data.bars).toHaveLength(12);
    expect(first.deadLetters.gas.data.bars.at(-1).to).toBe(first.window.to);
    expect(first.deadLetters.cw).toEqual({
      data: null,
      sourceError: { hop: "CW-BE", reason: "ERRORED" },
    });

    expect(first.topErrors.gas.data.entries).toHaveLength(3);
    expect(first.topErrors.gas.data.entries[0]).toEqual(
      expect.objectContaining({
        errorKey: "Grant <v> not found",
        event: { value: "CreateCase", label: expect.any(String) },
        // The day-old dead letter too: top errors are every current one.
        count: 4,
        list: {
          path: "events/gas/outbox",
          query: {
            status: "DEAD_LETTER",
            error: "Grant <v> not found",
            event: "CreateCase",
          },
        },
      }),
    );
    expect(first.topErrors.gas.data.entries.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          errorKey: "Grant <v> not found",
          event: { value: "Audit", label: expect.any(String) },
          count: 1,
        }),
        expect.objectContaining({
          errorKey: "No error recorded",
          count: 1,
          list: {
            path: "events/gas/inbox",
            query: {
              status: "DEAD_LETTER",
              error: "No error recorded",
              event: "CaseStatusUpdated",
            },
          },
        }),
      ]),
    );
    expect(first.topErrors.cw.data.entries).toEqual([
      expect.objectContaining({
        errorKey: "Status <v> unknown",
        event: { value: "UpdateCaseStatus", label: "Update case status" },
        count: 4,
        list: {
          path: "events/cw/inbox",
          query: {
            status: "DEAD_LETTER",
            error: "Status <v> unknown",
            event: "UpdateCaseStatus",
          },
        },
      }),
    ]);

    expect(
      first.configFailed.gas.data.versions
        .filter(({ code }) => code === "overview-grant")
        .map(({ version, definition }) => [version, definition]),
    ).toEqual([
      ["1.0.0", "permanent_error"],
      ["1.1.0", "transient_error"],
    ]);
    expect(first.configFailed.cw.data).toEqual({ versions: [], more: false });

    const gasTokens = first.tokensExpiring.gas.data.tokens.map(
      ({ clientId }) => clientId,
    );
    expect(gasTokens).toContain("it-overview-soon");
    expect(gasTokens).not.toContain("it-overview-later");
    expect(first.tokensExpiring.cw.data.tokens).toEqual([
      expect.objectContaining({
        clientId: "fg-gas-backend",
        status: "EXPIRED",
      }),
    ]);
    expect(first.tokensExpiring.cw.data.tokens[0]).not.toHaveProperty("stored");

    const requests = await cwStubRequests();
    expect(
      requests.map(({ method, path }) => `${method} ${path}`).sort(),
    ).toEqual([
      "GET /actuators/buckets",
      "GET /actuators/clients",
      "GET /actuators/dead-letters",
      "POST /actuators/buckets/cw.inbox/summaries/errors",
      "POST /actuators/buckets/cw.outbox/summaries/errors",
      "POST /actuators/buckets/cw.workflows/query",
      "POST /actuators/buckets/cw.workflows/query",
    ]);
    expect(requests.every(({ actorId }) => actorId === OID)).toBe(true);
    expect(
      requests
        .filter(({ path }) => path === "/actuators/buckets/cw.workflows/query")
        .map(({ body }) => body.where.fetchStatus)
        .sort(),
    ).toEqual(["permanent_error", "transient_error"]);
    expect(
      requests.find(({ path }) => path === "/actuators/dead-letters").query,
    ).toEqual(first.window);
    expect(
      requests
        .filter(({ path }) => path.endsWith("/summaries/errors"))
        .map(({ body }) => body),
    ).toEqual([{}, {}]);
  });

  it("reads the part that failed again in the background, over the same window, the rest kept", async () => {
    await resetCwStub();
    await setCwStub({
      buckets: {
        deadLetters: {
          ...first.window,
          countCap: 10_000,
          buckets: [
            {
              id: "cw.outbox",
              list: {
                path: "events/cw/outbox",
                query: { status: "DEAD_LETTER" },
              },
              bins: withEdges(first.window.from, [
                ...cwBins().slice(0, 11),
                { count: 2, capped: false },
              ]),
            },
          ],
        },
      },
    });

    // The first retry waits five seconds from the answer.
    const retryAt = Date.parse(first.at) + 5_000;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, retryAt - Date.now())),
    );
    await expect
      .poll(async () => (await readOverview()).deadLetters.cw.data?.count, {
        timeout: 10_000,
        interval: 250,
      })
      .toBe(2);
    const second = await readOverview();

    expect(second.at).toBe(first.at);
    expect(second.deadLetters.cw.data.lists).toEqual([
      {
        box: "outbox",
        count: 2,
        capped: false,
        list: {
          path: "events/cw/outbox",
          query: { status: "DEAD_LETTER", ...first.window },
        },
      },
    ]);
    expect(second.topErrors).toEqual(first.topErrors);
    expect(await keptPaths()).toEqual(["GET /actuators/dead-letters"]);
  }, 30_000);

  it("answers from the kept answer, asking Caseworking only for the caller's own tokens", async () => {
    await resetCwStub();

    const third = await readOverview();

    expect(third.at).toBe(first.at);
    expect(await cwPaths()).toEqual(["GET /actuators/clients"]);
  });

  it("refuses a read that names no operator", async () => {
    const refused = await wreck
      .get("/grant-admin/overview", { headers: { "x-actor": "Jo Operator" } })
      .catch((error) => error);

    expect(refused.output.statusCode).toBe(400);
  });
});
