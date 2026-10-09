import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applicationPageSchemas } from "../../src/grant-admin/schemas/application-page.schema.js";
import { casePageSchemas } from "../../src/grant-admin/schemas/case-page.schema.js";
import { searchCasesResponseSchema } from "../../src/grant-admin/schemas/search-cases.schema.js";
import { cwStubRequests, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ACTOR = "UTF-8''%C5%81ukasz";
const OPERATOR = { "x-actor": ACTOR, "x-actor-id": OID };
const AUDIT_TOPIC =
  "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn";
const WORKFLOW = "frps-private-beta";

let client;
let applications;
let inbox;
let outbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db();
  applications = db.collection("applications");
  inbox = db.collection("inbox");
  outbox = db.collection("outbox");
});

afterAll(async () => {
  await client?.close();
});

beforeEach(async () => {
  await resetCwStub();
});

const POSITION = { phase: "PRE_AWARD", stage: "REVIEW", status: "RECEIVED" };

const aCaseRow = (caseRef, overrides = {}) => ({
  ref: { caseRef, workflowCode: WORKFLOW },
  position: POSITION,
  closed: true,
  closedAt: "2026-06-18T10:00:00.000Z",
  createdAt: "2026-06-16T10:00:00.000Z",
  replaced: false,
  ...overrides,
});

const SERIES = {
  latestRef: "ref-1",
  refs: ["ref-0", "ref-1"],
  members: [
    {
      caseRef: "ref-0",
      position: POSITION,
      createdAt: "2026-06-15T10:00:00.000Z",
      closedAt: "2026-06-15T12:00:00.000Z",
    },
    {
      caseRef: "ref-1",
      position: POSITION,
      createdAt: "2026-06-16T10:00:00.000Z",
      closedAt: "2026-06-18T10:00:00.000Z",
    },
  ],
};

const aCaseRead = (caseRef) => ({
  case: {
    ...aCaseRow(caseRef),
    originalConfigVersion: "1.0.0",
    currentConfigVersion: "1.1.0",
    series: SERIES,
  },
  storedBytes: 4096,
  document: {
    _id: "665f1c2e9a1b2c3d4e5f6a7b",
    caseRef,
    workflowCode: WORKFLOW,
    payload: { answers: { parcels: [["SX0679-9238", 1.5]] } },
    supplementaryData: { lookups: { anything: true } },
  },
});

const anApplication = (clientRef) => ({
  _id: new ObjectId(),
  clientRef,
  code: WORKFLOW,
  currentPhase: "PRE_AWARD",
  currentStage: "REVIEW",
  currentStatus: "RECEIVED",
  createdAt: "2026-06-16T10:00:00.000Z",
  identifiers: { sbi: "106284736", frn: "1102658375", crn: "1100014934" },
});

// Longer than GAS gives Caseworking, so a timeout is GAS's answer, not ours.
const CLIENT_TIMEOUT_MS = 10_000;
const SLOW = { timeout: 15_000 };

const search = (payload = {}, headers = OPERATOR) =>
  wreck.post("/grant-admin/cases/search", {
    payload,
    headers,
    timeout: CLIENT_TIMEOUT_MS,
  });

const getTab = (tab, caseRef = "ref-1", headers = OPERATOR) =>
  wreck.get(`/grant-admin/workflows/${WORKFLOW}/cases/${caseRef}/${tab}`, {
    headers,
    timeout: CLIENT_TIMEOUT_MS,
  });

const caseRequests = async () =>
  (await cwStubRequests()).filter((request) => request.box === "cases");

const auditRows = (action) =>
  outbox
    .find({ target: AUDIT_TOPIC, "event.audit.entities.action": action })
    .toArray();

const statusOf = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error.output.statusCode;
  }

  return 200;
};

describe("POST /grant-admin/cases/search", () => {
  it("answers Caseworking's page of cases, with closed-at, replaced, the total and the workflow codes", async () => {
    await setCwStub({
      cases: {
        search: {
          cases: [
            aCaseRow("ref-2"),
            aCaseRow("ref-1", { closedAt: null, replaced: true }),
          ],
          pagination: { endCursor: "next", hasNextPage: true },
          total: { count: 2, capped: false },
          workflowCodes: [WORKFLOW, "woodland"],
        },
      },
    });

    const { payload: page, res } = await search({ workflowCode: WORKFLOW });

    expect(res.headers["cache-control"]).toBe("no-store");
    expect(searchCasesResponseSchema.validate(page).error).toBeUndefined();
    expect(page.rows.map((row) => row.ref.caseRef)).toEqual(["ref-2", "ref-1"]);
    expect(page.rows[0].closedAt).toBe("2026-06-18T10:00:00.000Z");
    expect(page.rows.map((row) => row.replaced)).toEqual([false, true]);
    expect(page.total).toEqual({ count: 2, capped: false });
    expect(page.workflowCodes).toEqual([WORKFLOW, "woodland"]);
  });

  it("answers a row from a Caseworking that predates replaced without it", async () => {
    const { replaced: _replaced, ...oldRow } = aCaseRow("ref-1");
    await setCwStub({
      cases: {
        search: {
          cases: [oldRow],
          pagination: { endCursor: null, hasNextPage: false },
        },
      },
    });

    const { payload: page } = await search({});

    expect(searchCasesResponseSchema.validate(page).error).toBeUndefined();
    expect(page.rows[0]).not.toHaveProperty("replaced");
  });

  it("sends Caseworking the query in the body, with the operator and the repeat flag", async () => {
    await search(
      { ref: "REF-1", from: "2026-06-15T00:00:00.000Z" },
      { ...OPERATOR, "x-search-repeat": "1" },
    );

    const [request] = await caseRequests();
    expect(request).toMatchObject({
      method: "POST",
      path: "/actuators/cases/search",
      query: {},
      body: { ref: "ref-1", from: "2026-06-15T00:00:00.000Z" },
      actor: ACTOR,
      actorId: OID,
      searchRepeat: "1",
    });

    const [row] = await auditRows("SEARCH_CASES");
    expect(row.event.audit.details).toMatchObject({
      mode: "search",
      repeat: true,
    });
  });

  it("never reads GAS's own applications or events", async () => {
    await applications.insertOne(anApplication("ref-1"));

    await search({});

    expect((await cwStubRequests()).map((request) => request.box)).toEqual([
      "cases",
    ]);
  });

  it.each([
    ["down", "down"],
    ["failing", "error"],
    ["slow", "timeout"],
  ])("answers 502 when Caseworking is %s", SLOW, async (_name, mode) => {
    await setCwStub({ cases: { mode } });

    expect(await statusOf(search({}))).toBe(502);

    const [row] = await auditRows("SEARCH_CASES");
    expect(row.event.audit.status).toBe("FAILURE");
    expect(row.event.user).toBe(OID);
  });

  it("writes one SEARCH_CASES row per page, with the operator and PMC 0706", async () => {
    await search({ workflowCode: WORKFLOW });

    const [row] = await auditRows("SEARCH_CASES");
    expect(row.segregationRef).toBe("admin-search-cases");
    expect(row.event).toMatchObject({
      user: OID,
      security: { pmccode: "0706" },
      audit: {
        status: "SUCCESS",
        entities: [
          { entity: "CASE", action: "SEARCH_CASES", entityid: "search" },
        ],
        details: { mode: "browse", workflowCode: WORKFLOW, page: "first" },
      },
    });
  });
});

describe("GET /grant-admin/workflows/{workflowCode}/cases/{caseRef}/{tab}", () => {
  beforeEach(async () => {
    await setCwStub({
      cases: { records: { [`${WORKFLOW}/ref-1`]: aCaseRead("ref-1") } },
    });
  });

  it("overview: Caseworking's facts and series members, with the application link from GAS", async () => {
    await applications.insertOne(anApplication("ref-1"));

    const { payload: page, res } = await getTab("overview");

    expect(res.headers["cache-control"]).toBe("no-store");
    expect(casePageSchemas.overview.validate(page).error).toBeUndefined();
    expect(page.header).toMatchObject({
      caseRef: "ref-1",
      workflowCode: WORKFLOW,
      position: POSITION,
      closed: true,
      closedAt: "2026-06-18T10:00:00.000Z",
      counterpart: { exists: true },
    });
    expect(page.overview).toEqual({
      workflowCode: WORKFLOW,
      originalConfigVersion: "1.0.0",
      currentConfigVersion: "1.1.0",
      createdAt: "2026-06-16T10:00:00.000Z",
      closed: true,
      closedAt: "2026-06-18T10:00:00.000Z",
      series: SERIES,
      storedBytes: 4096,
    });
  });

  it.each([
    [
      "a series with no members, from a Caseworking that predates them",
      { latestRef: "ref-1", refs: ["ref-1"] },
      { latestRef: "ref-1", refs: ["ref-1"] },
    ],
    [
      "a series with a field GAS does not know, mapped away",
      { ...SERIES, anything: true },
      SERIES,
    ],
  ])("overview: answers %s", async (_name, sent, answered) => {
    const read = aCaseRead("ref-1");
    read.case.series = sent;
    await setCwStub({ cases: { records: { [`${WORKFLOW}/ref-1`]: read } } });

    const { payload: page } = await getTab("overview");

    expect(casePageSchemas.overview.validate(page).error).toBeUndefined();
    expect(page.overview.series).toEqual(answered);
  });

  it.each([
    ["overview", ""],
    ["events", ""],
    ["raw", "document"],
  ])("reads Caseworking's case once for the %s tab", async (tab, include) => {
    await getTab(tab);

    const reads = (await caseRequests()).filter((request) =>
      request.path.endsWith("/cases/frps-private-beta/ref-1"),
    );
    expect(reads).toHaveLength(1);
    expect(reads[0].query.include ?? "").toBe(include);
    expect(reads[0]).toMatchObject({ actor: ACTOR, actorId: OID });
  });

  it("events: the rows for the case ref, a Caseworking inbox row among them", async () => {
    await setCwStub({
      inbox: {
        data: [
          {
            _id: "665f1c2e9a1b2c3d4e5f6a7c",
            messageId: "cw-msg-ref-1",
            type: "cloud.defra.local.fg-gas-backend.case.create",
            status: "COMPLETED",
            publicationDate: "2026-06-16T10:01:00.000Z",
            completionDate: null,
          },
        ],
      },
    });

    const { payload: page } = await getTab("events");

    expect(casePageSchemas.events.validate(page).error).toBeUndefined();
    expect(page.events.rows.map((row) => row.service)).toContain("caseworking");
  });

  it("raw: Caseworking's document whole, with its size", async () => {
    const { payload: page } = await getTab("raw");

    expect(casePageSchemas.raw.validate(page).error).toBeUndefined();
    expect(page.raw).toEqual(aCaseRead("ref-1").document);
    expect(page.storedBytes).toBe(4096);
  });

  it("draws an orphan case, and audits it with no accounts", async () => {
    const { payload: page } = await getTab("overview");

    expect(page.header.counterpart).toEqual({ exists: false });

    const [row] = await auditRows("VIEW_CASE_DATA");
    expect(row.event.audit.status).toBe("SUCCESS");
    expect(row.event.audit.accounts).toBeUndefined();
  });

  it("writes one VIEW_CASE_DATA row with the tab, the operator, PMC 0706 and the application's identifiers", async () => {
    await applications.insertOne(anApplication("ref-1"));

    await getTab("raw");

    const rows = await auditRows("VIEW_CASE_DATA");
    expect(rows).toHaveLength(1);
    expect(rows[0].segregationRef).toBe("admin-view-case");
    expect(rows[0].event).toMatchObject({
      user: OID,
      security: { pmccode: "0706" },
      audit: {
        entities: [
          { entity: "CASE", action: "VIEW_CASE_DATA", entityid: "ref-1" },
        ],
        details: { tab: "raw", workflowCode: WORKFLOW },
        accounts: { sbi: "106284736", frn: "1102658375", crn: "1100014934" },
      },
    });
    expect(JSON.stringify(rows[0].event)).not.toContain("SX0679-9238");
  });

  it("answers 404 CASE_NOT_FOUND for a case Caseworking does not have, audited as a FAILURE", async () => {
    await expect(getTab("overview", "nobody")).rejects.toMatchObject({
      output: { statusCode: 404 },
      data: { payload: { reason: "CASE_NOT_FOUND" } },
    });

    const [row] = await auditRows("VIEW_CASE_DATA");
    expect(row.event.audit.status).toBe("FAILURE");
  });

  it("answers 502 for a 404 with no reason: a Caseworking without the route", async () => {
    await setCwStub({ cases: { missingRoute: true } });

    expect(await statusOf(getTab("overview"))).toBe(502);
  });

  it(
    "answers 504 when Caseworking times out and 502 when it fails",
    SLOW,
    async () => {
      await setCwStub({ cases: { mode: "timeout" } });
      expect(await statusOf(getTab("overview"))).toBe(504);

      await setCwStub({ cases: { mode: "error" } });
      expect(await statusOf(getTab("overview"))).toBe(502);
    },
  );
});

describe("the case link on application pages", () => {
  beforeEach(async () => {
    await applications.insertOne(anApplication("ref-1"));
  });

  const appTab = (tab = "overview") =>
    wreck.get(`/grant-admin/grants/${WORKFLOW}/applications/ref-1/${tab}`, {
      headers: OPERATOR,
      timeout: CLIENT_TIMEOUT_MS,
    });

  it("says the case exists when Caseworking does, asking it with the operator's id but no name", async () => {
    await setCwStub({
      cases: { records: { [`${WORKFLOW}/ref-1`]: aCaseRead("ref-1") } },
    });

    const { payload: page } = await appTab();

    expect(
      applicationPageSchemas.overview.validate(page).error,
    ).toBeUndefined();
    expect(page.header.counterpart).toEqual({ exists: true });

    const [check] = await caseRequests();
    expect(check.path).toBe(`/actuators/cases/${WORKFLOW}/ref-1/existence`);
    expect(check.actor).toBeNull();
    expect(check.actorId).toBe(OID);
  });

  it(
    "answers 200 with the link unknown, and no source error, when Caseworking times out",
    SLOW,
    async () => {
      await setCwStub({ cases: { mode: "timeout" } });

      const { payload: page } = await appTab();

      expect(page.header.counterpart).toBeNull();
      expect(page.sourceErrors).toEqual([]);
      expect(page.overview).not.toBeNull();
    },
  );

  it.each(["events", "raw"])(
    "never asks Caseworking about the case on the %s tab",
    async (tab) => {
      const { payload: page } = await appTab(tab);

      expect(page.header.counterpart).toBeNull();
      expect(await caseRequests()).toEqual([]);
    },
  );
});

describe("the record on a Caseworking event", () => {
  const ID = "665f1c2e9a1b2c3d4e5f6a7b";

  const aCwDetail = (found) => ({
    messageId: "cw-msg-1",
    type: "cloud.defra.local.fg-gas-backend.case.create",
    source: "GAS",
    segregationRef: `ref-1-${WORKFLOW}`,
    status: "DEAD_LETTER",
    completionAttempts: 7,
    maxAttempts: 7,
    eventTime: "2026-06-16T09:00:00.000Z",
    publicationDate: "2026-06-16T09:00:01.000Z",
    lastError: { name: "Error", message: "failed", at: null },
    event: {
      id: "cw-evt-1",
      data: { caseRef: "ref-1", workflowCode: WORKFLOW },
    },
    case: found,
  });

  const detail = async () =>
    (await wreck.get(`/grant-admin/events/caseworking/inbox/${ID}`)).payload;

  it("links to the case when Caseworking says it exists", async () => {
    await setCwStub({
      inbox: {
        detail: aCwDetail({
          workflowCode: WORKFLOW,
          caseRef: "ref-1",
          exists: true,
        }),
      },
    });

    expect((await detail()).record).toEqual({
      kind: "case",
      code: WORKFLOW,
      ref: "ref-1",
    });
  });

  it("gives no record, and keeps the searchRef, when the case is missing", async () => {
    await setCwStub({
      inbox: {
        detail: aCwDetail({
          workflowCode: WORKFLOW,
          caseRef: "ref-1",
          exists: false,
        }),
      },
    });

    const found = await detail();

    expect(found.record).toBeNull();
    expect(found.searchRef).toBe(`ref-1-${WORKFLOW}`);
  });

  it("makes no other call to draw the link", async () => {
    await setCwStub({ inbox: { detail: aCwDetail(null) } });

    await detail();

    expect((await cwStubRequests()).map((request) => request.box)).toEqual([
      "inbox",
    ]);
    expect(await inbox.countDocuments({})).toBe(0);
  });
});
