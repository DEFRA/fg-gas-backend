import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applicationPageSchemas } from "../../src/grant-admin/schemas/application-page.schema.js";
import { searchApplicationsResponseSchema } from "../../src/grant-admin/schemas/search-applications.schema.js";
import { cwStubRequests, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OPERATOR = { "x-actor": "Jo Operator", "x-actor-id": OID };
const AUDIT_TOPIC =
  "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn";

let client;
let applications;
let series;
let grants;
let inbox;
let outbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db();
  applications = db.collection("applications");
  series = db.collection("application_series");
  grants = db.collection("grants");
  inbox = db.collection("inbox");
  outbox = db.collection("outbox");
});

afterAll(async () => {
  await client?.close();
});

beforeEach(async () => {
  await resetCwStub();
});

const minute = (n) => new Date(Date.UTC(2026, 5, 16, 10, n)).toISOString();

const anApplication = (clientRef, overrides = {}) => ({
  _id: new ObjectId(),
  clientRef,
  code: "woodland",
  currentPhase: "PRE_AWARD",
  currentStage: "REVIEW",
  currentStatus: "RECEIVED",
  originalConfigVersion: "1.0.0",
  currentConfigVersion: "1.2.0",
  createdAt: minute(0),
  updatedAt: minute(5),
  submittedAt: new Date(minute(0)),
  identifiers: { sbi: "106284736", frn: "1102658375", crn: "1100014934" },
  metadata: { defraId: "d-1" },
  phases: [
    {
      code: "PRE_AWARD",
      answers: { parcels: [{ id: "SX0679-9238", area: 1.5 }], declared: true },
    },
  ],
  ...overrides,
});

const aSeries = (code, clientRefs) => ({
  code,
  clientRefs,
  latestClientRef: clientRefs.at(-1),
  latestClientId: "client-id",
  createdAt: minute(0),
  updatedAt: minute(0),
});

const search = (payload = {}, headers = OPERATOR) =>
  wreck.post("/grant-admin/applications/search", { payload, headers });

const pageOf = async (payload, headers) =>
  (await search(payload, headers)).payload;

const getTab = (
  tab,
  clientRef = "ref-1",
  code = "woodland",
  headers = OPERATOR,
) =>
  wreck.get(`/grant-admin/grants/${code}/applications/${clientRef}/${tab}`, {
    headers,
  });

const auditRows = (action) =>
  outbox
    .find({ target: AUDIT_TOPIC, "event.audit.entities.action": action })
    .toArray();

describe("POST /grant-admin/applications/search", () => {
  it("browses the 20 newest applications, ties broken by id, with a cursor", async () => {
    await applications.insertMany(
      Array.from({ length: 25 }, (_, n) =>
        anApplication(`ref-${n}`, { createdAt: minute(n) }),
      ),
    );

    const page = await pageOf({});

    expect(
      searchApplicationsResponseSchema.validate(page).error,
    ).toBeUndefined();
    expect(page.rows).toHaveLength(20);
    expect(page.rows[0].ref).toEqual({ clientRef: "ref-24", code: "woodland" });
    expect(page.rows[0].position).toEqual({
      phase: "PRE_AWARD",
      stage: "REVIEW",
      status: "RECEIVED",
    });
    expect(page.pagination.hasNextPage).toBe(true);
    expect(page.total).toEqual({ count: 25, capped: false });
    expect(page.sourceErrors).toEqual([]);
  });

  it("continues from the cursor with no gap or duplicate, and no total or codes", async () => {
    const createdAt = minute(1);
    await applications.insertMany(
      Array.from({ length: 25 }, (_, n) =>
        anApplication(`ref-${n}`, { createdAt }),
      ),
    );

    const first = await pageOf({});
    const next = await pageOf({ cursor: first.pagination.endCursor });

    const refs = [...first.rows, ...next.rows].map((row) => row.ref.clientRef);
    expect(new Set(refs).size).toBe(25);

    // Every createdAt ties, so the id alone orders them, newest first.
    const ids = Object.fromEntries(
      (await applications.find({}).toArray()).map((doc) => [
        doc.clientRef,
        doc._id.toHexString(),
      ]),
    );
    const order = refs.map((ref) => ids[ref]);
    expect(order).toEqual([...order].sort().reverse());
    expect(next.pagination.hasNextPage).toBe(false);
    expect(next).not.toHaveProperty("total");
    expect(next).not.toHaveProperty("codes");
  });

  it.each([
    [
      "an operator in place of a created time",
      { createdAt: { $gt: "" }, _id: "665f1c2e9a1b2c3d4e5f6a7b" },
    ],
    [
      "a number for a created time",
      { createdAt: 5, _id: "665f1c2e9a1b2c3d4e5f6a7b" },
    ],
    ["a malformed id", { createdAt: minute(1), _id: "nope" }],
    ["not JSON at all", "%%%not-a-cursor"],
  ])(
    "refuses a cursor carrying %s with 400, audited as a FAILURE",
    async (_name, data) => {
      const cursor =
        typeof data === "string"
          ? data
          : Buffer.from(JSON.stringify(data)).toString("base64url");

      const error = await search({ cursor }).catch((e) => e);

      expect(error.output.statusCode).toBe(400);
      const [row] = await auditRows("SEARCH_APPLICATIONS");
      expect(row.event.audit.status).toBe("FAILURE");
      expect(row.event.audit.details.page).toBe("next");
    },
  );

  it("narrows by grant and by created time together", async () => {
    await applications.insertMany([
      anApplication("in", { createdAt: minute(10) }),
      anApplication("too-early", { createdAt: minute(1) }),
      anApplication("other-grant", { code: "frps", createdAt: minute(10) }),
    ]);

    const page = await pageOf({
      code: "woodland",
      from: minute(5),
      to: minute(15),
    });

    expect(page.rows.map((row) => row.ref.clientRef)).toEqual(["in"]);
    expect(page.total).toEqual({ count: 1, capped: false });
  });

  it("finds every member of a searched ref's series, the earlier ones replaced", async () => {
    await applications.insertMany([
      anApplication("ref-1", { createdAt: minute(1) }),
      anApplication("ref-2", { createdAt: minute(2) }),
      anApplication("ref-3", { createdAt: minute(3) }),
      anApplication("ref-1", { code: "frps", createdAt: minute(4) }),
      anApplication("unrelated", { createdAt: minute(5) }),
    ]);
    await series.insertOne(aSeries("woodland", ["ref-1", "ref-2", "ref-3"]));

    const page = await pageOf({ ref: "REF-1" });

    // ref-1 was reused under another grant: shown, but nothing replaced it.
    expect(
      page.rows.map((row) => [row.ref.clientRef, row.ref.code, row.replaced]),
    ).toEqual([
      ["ref-1", "frps", false],
      ["ref-3", "woodland", false],
      ["ref-2", "woodland", true],
      ["ref-1", "woodland", true],
    ]);
    expect(page.pagination).toEqual({ endCursor: null, hasNextPage: false });
    expect(page.total).toEqual({ count: 4, capped: false });
  });

  it("narrows a ref search to the grant and the time range", async () => {
    await applications.insertMany([
      anApplication("ref-1", { createdAt: minute(1) }),
      anApplication("ref-2", { createdAt: minute(2) }),
      anApplication("ref-1", { code: "frps", createdAt: minute(4) }),
    ]);
    await series.insertOne(aSeries("woodland", ["ref-1", "ref-2"]));

    const page = await pageOf({
      ref: "ref-1",
      code: "woodland",
      from: minute(2),
    });

    expect(page.rows.map((row) => row.ref.clientRef)).toEqual(["ref-2"]);
  });

  it("caps the first page's total at 10,000", async () => {
    await applications.insertMany(
      Array.from({ length: 10_001 }, (_, n) => ({
        clientRef: `bulk-${n}`,
        code: "woodland",
        createdAt: minute(n % 60),
      })),
    );

    expect((await pageOf({})).total).toEqual({ count: 10_000, capped: true });
  });

  it("offers the grant codes on the first page", async () => {
    await grants.insertMany([
      { code: "woodland", version: "1.0.0" },
      { code: "frps", version: "1.0.0" },
    ]);

    expect((await pageOf({})).codes).toEqual(["frps", "woodland"]);
  });

  it("is never stored by a cache", async () => {
    const { res } = await search({});

    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("writes one audit row per page, with the operator, PMC 0706 and how the list was narrowed", async () => {
    await applications.insertOne(anApplication("ref-1"));

    await search({ code: "woodland" });
    await search({ ref: "ref-1" }, { ...OPERATOR, "x-search-repeat": "1" });

    const rows = await auditRows("SEARCH_APPLICATIONS");
    expect(rows).toHaveLength(2);

    const byMode = Object.fromEntries(
      rows.map((row) => [row.event.audit.details.mode, row]),
    );
    expect(byMode.browse.event.user).toBe(OID);
    expect(byMode.browse.event.security.pmccode).toBe("0706");
    expect(byMode.browse.segregationRef).toBe("admin-search-applications");
    expect(byMode.browse.event.audit.details).toMatchObject({
      mode: "browse",
      code: "woodland",
      page: "first",
      resultCount: 1,
      total: { count: 1, capped: false },
    });
    expect(byMode.browse.event.audit.details).not.toHaveProperty("repeat");
    expect(byMode.search.event.audit.details).toMatchObject({
      mode: "search",
      repeat: true,
    });
    expect(JSON.stringify(byMode.search.event)).not.toContain("ref-1");
  });

  it("records no repeat on a later page, whatever the header says", async () => {
    await applications.insertMany(
      Array.from({ length: 21 }, (_, n) =>
        anApplication(`ref-${n}`, { createdAt: minute(n) }),
      ),
    );
    const first = await pageOf({});

    await search(
      { cursor: first.pagination.endCursor },
      { ...OPERATOR, "x-search-repeat": "1" },
    );

    const next = (await auditRows("SEARCH_APPLICATIONS")).find(
      (row) => row.event.audit.details.page === "next",
    );
    expect(next.event.audit.details).not.toHaveProperty("repeat");
  });

  it.each([
    ["no x-actor-id", { "x-actor": "Jo Operator" }],
    ["no x-actor", { "x-actor-id": OID }],
  ])("refuses a request with %s", async (_name, headers) => {
    await expect(search({}, headers)).rejects.toThrow(
      "Response Error: 400 Bad Request",
    );
  });

  it("refuses another client with 403", async () => {
    await expect(
      wreck.post("/grant-admin/applications/search", {
        payload: {},
        headers: {
          ...OPERATOR,
          authorization: "Bearer 22222222-2222-2222-2222-222222222222",
        },
      }),
    ).rejects.toThrow("Response Error: 403 Forbidden");
  });

  it("never calls Caseworking", async () => {
    await search({});

    expect(await cwStubRequests()).toEqual([]);
  });
});

describe("GET /grant-admin/grants/{code}/applications/{clientRef}/{tab}", () => {
  it("overview: the trimmed facts, the series and the stored size", async () => {
    await applications.insertOne(anApplication("ref-1"));
    await series.insertOne(aSeries("woodland", ["ref-1", "ref-2"]));

    const { payload: page, res } = await getTab("overview");

    expect(res.headers["cache-control"]).toBe("no-store");
    expect(
      applicationPageSchemas.overview.validate(page).error,
    ).toBeUndefined();
    expect(page.header).toMatchObject({
      clientRef: "ref-1",
      code: "woodland",
      counterpart: { exists: false },
    });
    expect(page.overview).toMatchObject({
      code: "woodland",
      originalConfigVersion: "1.0.0",
      currentConfigVersion: "1.2.0",
      submittedAt: minute(0),
      createdAt: minute(0),
      updatedAt: minute(5),
      identifiers: { sbi: "106284736", frn: "1102658375", crn: "1100014934" },
      series: { latestRef: "ref-2", refs: ["ref-1", "ref-2"] },
    });
    expect(page.overview.storedBytes).toBeGreaterThan(0);
    expect(page.overview).not.toHaveProperty("metadata");
  });

  it("overview: reads a legacy document with only a config version and no submitted time", async () => {
    await applications.insertOne(
      anApplication("ref-1", {
        originalConfigVersion: undefined,
        currentConfigVersion: undefined,
        configVersion: "0.9.0",
        submittedAt: undefined,
        identifiers: undefined,
      }),
    );

    const { payload: page } = await getTab("overview");

    expect(page.overview).toMatchObject({
      originalConfigVersion: "0.9.0",
      currentConfigVersion: "0.9.0",
      submittedAt: null,
      identifiers: { sbi: null, frn: null, crn: null },
    });
  });

  it("overview: shows a submitted or updated time that is not an instant as stored", async () => {
    await applications.insertOne(
      anApplication("ref-1", {
        submittedAt: "not-an-instant",
        updatedAt: "2026-06-16T11:05:00+01:00",
      }),
    );

    const { payload: page } = await getTab("overview");

    expect(
      applicationPageSchemas.overview.validate(page).error,
    ).toBeUndefined();
    expect(page.overview).toMatchObject({
      submittedAt: "not-an-instant",
      updatedAt: "2026-06-16T11:05:00+01:00",
    });
  });

  const anInboxRow = (clientRef) => ({
    _id: new ObjectId(),
    messageId: `msg-${clientRef}`,
    type: "cloud.defra.local.fg-cw-backend.case.status.updated",
    source: "CW",
    segregationRef: `${clientRef}-woodland`,
    status: "COMPLETED",
    completionAttempts: 1,
    eventTime: minute(1),
    publicationDate: minute(1),
    claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    event: { id: `evt-${clientRef}`, data: { caseRef: clientRef } },
  });

  const aCwRow = {
    _id: "665f1c2e9a1b2c3d4e5f0001",
    eventId: "cw-evt-ref-1",
    type: "cloud.defra.local.fg-gas-backend.case.create",
    status: "COMPLETED",
    publicationDate: minute(2),
    completedAt: minute(2),
  };

  it("events: the GAS and Caseworking rows for the ref merged, audit rows left out", async () => {
    await applications.insertOne(anApplication("ref-1"));
    await inbox.insertOne(anInboxRow("ref-1"));
    await setCwStub({ inbox: { data: [aCwRow] } });

    const { payload: page } = await getTab("events");

    expect(applicationPageSchemas.events.validate(page).error).toBeUndefined();
    expect(page.events.rows.map((row) => [row.service, row.eventId])).toEqual([
      ["caseworking", "cw-evt-ref-1"],
      ["gas", "msg-ref-1"],
    ]);
    expect(page.events.more).toBe(false);
    expect(page.sourceErrors).toEqual([]);

    const pages = (await cwStubRequests()).filter(
      (request) => request.box === "page",
    );
    expect(pages.map((request) => request.query.q)).toEqual(["ref-1"]);
    expect(pages[0].query.audit).toBe("exclude");
  });

  it("events: GAS's rows still, and a source error, when Caseworking is down", async () => {
    await applications.insertOne(anApplication("ref-1"));
    await inbox.insertOne(anInboxRow("ref-1"));
    await setCwStub({ inbox: { mode: "down" }, outbox: { mode: "down" } });

    const { payload: page } = await getTab("events");

    expect(page.events.rows.map((row) => row.eventId)).toEqual(["msg-ref-1"]);
    expect(page.sourceErrors).toEqual([
      { hop: "CW-BE Inbox" },
      { hop: "CW-BE Outbox" },
    ]);
    expect(page.sectionErrors).toEqual([]);
  });

  it("raw: the whole stored document, two differently shaped answers back unchanged", async () => {
    const wmp = anApplication("ref-1");
    const frps = anApplication("ref-2", {
      phases: [
        {
          code: "PRE_AWARD",
          answers: { applicant: { business: { name: "X" } } },
        },
        { code: "AWARD", answers: { actions: [["CMOR1", 3]], total: 12.75 } },
      ],
    });
    await applications.insertMany([wmp, frps]);

    for (const doc of [wmp, frps]) {
      const { payload: page } = await getTab("raw", doc.clientRef);

      expect(applicationPageSchemas.raw.validate(page).error).toBeUndefined();
      expect(page.raw.phases).toEqual(doc.phases);
      expect(page.raw.metadata).toEqual(doc.metadata);
      expect(page.raw._id).toBe(doc._id.toHexString());
      expect(page.raw).not.toHaveProperty("storedBytes");
      expect(page.storedBytes).toBeGreaterThan(0);
    }
  });

  it("raw: a document with its own storedBytes field comes back unchanged", async () => {
    const doc = anApplication("ref-1", { storedBytes: "the document's own" });
    await applications.insertOne(doc);

    const { payload: page } = await getTab("raw");

    expect(page.raw.storedBytes).toBe("the document's own");
    expect(page.raw.phases).toEqual(doc.phases);
    expect(page.storedBytes).toBeGreaterThan(0);
  });

  it("raw: a document over 1 MiB is too large to show, its size still given", async () => {
    await applications.insertOne(
      anApplication("ref-1", {
        phases: [
          { code: "PRE_AWARD", answers: { blob: "x".repeat(1_100_000) } },
        ],
      }),
    );

    const { payload: page } = await getTab("raw");

    expect(page.raw).toBeNull();
    expect(page.storedBytes).toBeGreaterThan(1_100_000);
    expect(page.sectionErrors).toEqual([
      { section: "raw", message: "too large to show" },
    ]);
  });

  it("answers 404 APPLICATION_NOT_FOUND for an unknown application, audited as a FAILURE", async () => {
    const error = await getTab("overview", "nobody").catch((e) => e);

    expect(error.output.statusCode).toBe(404);
    expect(error.data.payload.reason).toBe("APPLICATION_NOT_FOUND");

    const [row] = await auditRows("VIEW_APPLICATION");
    expect(row.event.audit.status).toBe("FAILURE");
    expect(row.event.audit.details.tab).toBe("overview");
    expect(row.event.audit.accounts).toBeUndefined();
  });

  it("writes one VIEW_APPLICATION row per tab, with the operator, PMC 0706, the tab and the identifiers", async () => {
    await applications.insertOne(anApplication("ref-1"));

    await getTab("raw");

    const rows = await auditRows("VIEW_APPLICATION");
    expect(rows).toHaveLength(1);
    expect(rows[0].segregationRef).toBe("admin-view-application");
    expect(rows[0].event).toMatchObject({
      user: OID,
      security: { pmccode: "0706" },
      audit: {
        status: "SUCCESS",
        entities: [
          {
            entity: "APPLICATION",
            action: "VIEW_APPLICATION",
            entityid: "ref-1",
          },
        ],
        details: { tab: "raw", code: "woodland" },
        accounts: { sbi: "106284736", frn: "1102658375", crn: "1100014934" },
      },
    });
    expect(JSON.stringify(rows[0].event)).not.toContain("SX0679-9238");
  });

  it("answers 500 with no data when the audit cannot be committed", async () => {
    // An audit entity id is at most 120 characters, so this view's audit is refused.
    const clientRef = "r".repeat(121);
    await applications.insertOne(anApplication(clientRef));

    const error = await getTab("raw", clientRef).catch((e) => e);

    expect(error.output.statusCode).toBe(500);
    expect(JSON.stringify(error.data.payload)).not.toContain("SX0679-9238");
  });

  it("refuses a request with no x-actor-id", async () => {
    await expect(
      getTab("overview", "ref-1", "woodland", { "x-actor": "Jo Operator" }),
    ).rejects.toThrow("Response Error: 400 Bad Request");
  });
});

describe("the operator on the existing event routes", () => {
  const anInboxDoc = (data) => ({
    _id: new ObjectId(),
    messageId: `msg-${new ObjectId().toHexString()}`,
    type: "cloud.defra.local.fg-cw-backend.case.status.updated",
    source: "CW",
    segregationRef: "ref-1-woodland",
    status: "COMPLETED",
    completionAttempts: 1,
    eventTime: minute(1),
    publicationDate: minute(1),
    claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    event: { id: "evt-1", data },
  });

  it("records the operator and PMC 0706 on VIEW_EVENT, and links a GAS row to its application", async () => {
    await applications.insertOne(anApplication("ref-1"));
    const doc = anInboxDoc({ caseRef: "ref-1", workflowCode: "woodland" });
    await inbox.insertOne(doc);

    const { payload: detail } = await wreck.get(
      `/grant-admin/events/gas/inbox/${doc._id.toHexString()}`,
      { headers: OPERATOR },
    );

    expect(detail.record).toEqual({
      kind: "application",
      code: "woodland",
      ref: "ref-1",
    });
    expect(detail.searchRef).toBe("ref-1-woodland");

    const [row] = await auditRows("VIEW_EVENT");
    expect(row.event.user).toBe(OID);
    expect(row.event.security.pmccode).toBe("0706");
  });

  it("gives no record but keeps the searchRef when the application is missing", async () => {
    const doc = anInboxDoc({ caseRef: "ref-9", workflowCode: "woodland" });
    await inbox.insertOne(doc);

    const { payload: detail } = await wreck.get(
      `/grant-admin/events/gas/inbox/${doc._id.toHexString()}`,
    );

    expect(detail.record).toBeNull();
    expect(detail.searchRef).toBe("ref-1-woodland");

    const [row] = await auditRows("VIEW_EVENT");
    expect(row.event.user).toBeUndefined();
  });

  it("forwards the operator's id to Caseworking on a redrive", async () => {
    await wreck
      .post(
        "/grant-admin/events/caseworking/inbox/665f1c2e9a1b2c3d4e5f6aaa/redrive",
        { headers: OPERATOR },
      )
      .catch(() => {});

    const [request] = await cwStubRequests();
    expect(request.actorId).toBe(OID);
  });
});
