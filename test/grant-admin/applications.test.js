import { BSON, MongoClient, ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { env } from "node:process";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { toApplicationLink } from "../../src/events/case-refs.js";
import { applicationPageSchemas } from "../../src/grant-admin/schemas/application-page.schema.js";
import { submitApplication } from "../helpers/applications.js";
import {
  cwStubRequestsBesideCatalogue,
  resetCwStub,
  setCwStub,
} from "../helpers/cw-stub.js";
import {
  createGrant,
  createTestGrant,
  insertGrant,
} from "../helpers/grants.js";
import { ODD_ELEMENTS, rawInsert, withElements } from "../helpers/raw-bson.js";
import { sendMessage } from "../helpers/sqs.js";
import { wreck } from "../helpers/wreck.js";
import { withoutShell } from "../helpers/shell.js";

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OPERATOR = { "x-actor": "Jo Operator", "x-actor-id": OID };
const AUDIT_TOPIC =
  "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn";

let client;
let db;
let applications;
let series;
let inbox;
let outbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db();
  applications = db.collection("applications");
  series = db.collection("application_series");
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
  identifiers: { sbi: "900000005", frn: "9100000006", crn: "9000000006" },
  metadata: { defraId: "d-1" },
  phases: [
    {
      code: "PRE_AWARD",
      answers: { parcels: [{ id: "AA0109-0118", area: 1.5 }], declared: true },
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

describe("GET /grant-admin/grants/{code}/applications/{clientRef}/{tab}", () => {
  it("overview: the trimmed facts, the series with its members oldest first, and the stored size", async () => {
    await applications.insertMany([
      anApplication("ref-2", {
        createdAt: minute(2),
        currentStatus: "AWAITING_AMENDMENT",
      }),
      anApplication("ref-1"),
      anApplication("ref-2", { code: "frps", createdAt: minute(3) }),
    ]);
    await series.insertOne(aSeries("woodland", ["ref-1", "ref-2"]));

    const { payload: page, res } = await getTab("overview");

    expect(res.headers["cache-control"]).toBe("no-store");
    expect(
      applicationPageSchemas.overview.validate(withoutShell(page)).error,
    ).toBeUndefined();
    expect(page.shell.catalogue.buckets).toEqual(expect.any(Array));
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
      identifiers: { sbi: "900000005", frn: "9100000006", crn: "9000000006" },
      series: {
        latestRef: "ref-2",
        refs: ["ref-1", "ref-2"],
        members: [
          {
            clientRef: "ref-1",
            position: {
              phase: "PRE_AWARD",
              stage: "REVIEW",
              status: "RECEIVED",
            },
            createdAt: minute(0),
          },
          {
            clientRef: "ref-2",
            position: {
              phase: "PRE_AWARD",
              stage: "REVIEW",
              status: "AWAITING_AMENDMENT",
            },
            createdAt: minute(2),
          },
        ],
      },
    });
    expect(page.overview.storedBytes).toBeGreaterThan(0);
    expect(page.overview).not.toHaveProperty("metadata");
  });

  it("overview: a series member with no application keeps its slot, with no facts", async () => {
    await applications.insertOne(anApplication("ref-2"));
    await series.insertOne(aSeries("woodland", ["ref-1", "ref-2"]));

    const { payload: page } = await getTab("overview", "ref-2");

    expect(
      applicationPageSchemas.overview.validate(withoutShell(page)).error,
    ).toBeUndefined();
    expect(page.overview.series.members.map((m) => m.clientRef)).toEqual([
      "ref-1",
      "ref-2",
    ]);
    expect(page.overview.series.members[0]).toEqual({
      clientRef: "ref-1",
      position: { phase: null, stage: null, status: null },
      createdAt: null,
    });
  });

  it("overview: a series of one lists no members", async () => {
    await applications.insertOne(anApplication("ref-1"));
    await series.insertOne(aSeries("woodland", ["ref-1"]));

    const { payload: page } = await getTab("overview");

    expect(page.overview.series).toEqual({
      latestRef: "ref-1",
      refs: ["ref-1"],
      members: [],
    });
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

    expect(page.header.version).toBe("0.9.0");
    expect(page.overview).toMatchObject({
      originalConfigVersion: "0.9.0",
      currentConfigVersion: "0.9.0",
      submittedAt: null,
      identifiers: { sbi: null, frn: null, crn: null },
    });
  });

  it.each(["overview", "events", "raw"])(
    "%s: the header names the current config version",
    async (tab) => {
      await applications.insertOne(anApplication("ref-1"));

      const { payload: page } = await getTab(tab);

      expect(
        applicationPageSchemas[tab].validate(withoutShell(page)).error,
      ).toBeUndefined();
      expect(page.header.version).toBe("1.2.0");
    },
  );

  it("overview: shows a submitted or updated time that is not an instant as stored", async () => {
    await applications.insertOne(
      anApplication("ref-1", {
        submittedAt: "not-an-instant",
        updatedAt: "2026-06-16T11:05:00+01:00",
      }),
    );

    const { payload: page } = await getTab("overview");

    expect(
      applicationPageSchemas.overview.validate(withoutShell(page)).error,
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
    eventType: "CaseStatusUpdated",
    refs: [
      `ref:${clientRef}`,
      toApplicationLink("woodland", clientRef),
      `id:evt-${clientRef}`,
    ],
  });

  it("events: the GAS rows for the ref alone, with no request to Caseworking", async () => {
    await applications.insertOne(anApplication("ref-1"));
    await inbox.insertOne(anInboxRow("ref-1"));

    const { payload: page } = await getTab("events");

    expect(
      applicationPageSchemas.events.validate(withoutShell(page)).error,
    ).toBeUndefined();
    expect(page.events.rows.map((row) => [row.service, row.eventId])).toEqual([
      ["gas", "msg-ref-1"],
    ]);
    expect(page.events.more).toBe(false);
    expect(page.sourceErrors).toEqual([]);
    expect(await cwStubRequestsBesideCatalogue()).toEqual([]);
  });

  it("events: never a row found by the ref alone, without its grant's link", async () => {
    await applications.insertOne(anApplication("ref-1"));
    await inbox.insertOne({
      ...anInboxRow("ref-1"),
      refs: ["ref:ref-1", "id:evt-ref-1"],
    });

    const { payload: page } = await getTab("events");

    expect(page.events.rows).toEqual([]);
  });

  it("events: the same rows, and no source error, when Caseworking is down", async () => {
    await applications.insertOne(anApplication("ref-1"));
    await inbox.insertOne(anInboxRow("ref-1"));
    await setCwStub({ buckets: { mode: "down" } });

    const { payload: page } = await getTab("events");

    expect(page.events.rows.map((row) => row.eventId)).toEqual(["msg-ref-1"]);
    expect(page.sourceErrors).toEqual([]);
    expect(page.sectionErrors).toEqual([]);
  });

  const storedOf = async (clientRef) => {
    const [buf] = await applications
      .find({ clientRef }, { raw: true })
      .toArray();

    return Buffer.from(buf);
  };

  const bytesOf = (page) => Buffer.from(page.document, "base64");

  it("raw: the stored document as its own bytes, every type and key kept", async () => {
    const doc = withElements(
      BSON.serialize(anApplication("ref-1", { storedBytes: "its own" })),
      ODD_ELEMENTS,
    );
    await rawInsert(env.MONGO_URI, db.databaseName, "applications", [doc]);

    const { payload: page } = await getTab("raw");

    expect(
      applicationPageSchemas.raw.validate(withoutShell(page)).error,
    ).toBeUndefined();
    expect(page).not.toHaveProperty("raw");
    expect(bytesOf(page).equals(await storedOf("ref-1"))).toBe(true);
    expect(bytesOf(page).equals(doc)).toBe(true);
    expect(page.storedBytes).toBe(doc.length);
    expect(page.sectionErrors).toEqual([]);
  });

  it("raw: two differently shaped documents, each as stored", async () => {
    const frps = anApplication("ref-2", {
      phases: [
        { code: "AWARD", answers: { actions: [["CMOR1", 3]], total: 12.75 } },
      ],
    });
    await applications.insertMany([anApplication("ref-1"), frps]);

    for (const clientRef of ["ref-1", "ref-2"]) {
      const { payload: page } = await getTab("raw", clientRef);

      expect(bytesOf(page).equals(await storedOf(clientRef))).toBe(true);
    }
  });

  const ofSize = (bytes) => {
    const doc = anApplication("ref-1", { pad: "" });

    return { ...doc, pad: "x".repeat(bytes - BSON.calculateObjectSize(doc)) };
  };

  it("raw: a document of 900 KiB is shown whole", async () => {
    await applications.insertOne(ofSize(900 * 1024));

    const { payload: page } = await getTab("raw");

    expect(bytesOf(page)).toHaveLength(900 * 1024);
    expect(page.storedBytes).toBe(900 * 1024);
    expect(page.sectionErrors).toEqual([]);
  });

  it.each([
    ["1 MiB and 1 byte", 1024 * 1024 + 1],
    ["2 MiB", 2 * 1024 * 1024],
  ])(
    "raw: a document of %s is too large to show, its size still given",
    async (_, bytes) => {
      await applications.insertOne(ofSize(bytes));

      const { payload: page } = await getTab("raw");

      expect(
        applicationPageSchemas.raw.validate(withoutShell(page)).error,
      ).toBeUndefined();
      expect(page.header.clientRef).toBe("ref-1");
      expect(page.document).toBeNull();
      expect(page.storedBytes).toBe(bytes);
      expect(page.sectionErrors).toEqual([
        { section: "raw", message: "too large to show" },
      ]);
    },
  );

  it("raw: a document of more values than one may print is too large to show", async () => {
    const letters = [..."abcdefghijklmnopqrstuvwxyz"];
    await applications.insertOne(
      anApplication("ref-1", {
        dense: Array.from({ length: 10_000 }, () =>
          Object.fromEntries(letters.map((letter) => [letter, null])),
        ),
      }),
    );

    const { payload: page } = await getTab("raw");

    expect(page.document).toBeNull();
    expect(page.storedBytes).toBeLessThan(1024 * 1024);
    expect(page.sectionErrors).toEqual([
      { section: "raw", message: "too large to show" },
    ]);
  });

  it.each(["overview", "events", "raw"])(
    "%s: names where the application is from its grant version's definition, and none on a version not stored",
    async (tab) => {
      const grant = createTestGrant({ code: "woodland", version: "1.2.0" });
      grant.phases[0].name = "Pre award";
      grant.phases[0].stages[0].name = "Assessment";
      await insertGrant(grant);
      await applications.insertMany([
        anApplication("ref-1", {
          currentStage: "ASSESSMENT",
          currentStatus: "IN_REVIEW",
        }),
        anApplication("ref-2", { currentConfigVersion: "9.9.9" }),
      ]);

      const { payload: page } = await getTab(tab);
      const { payload: unnamed } = await getTab(tab, "ref-2");

      expect(
        applicationPageSchemas[tab].validate(withoutShell(page)).error,
      ).toBeUndefined();
      expect(page.header.names).toEqual({
        phases: [{ code: "PRE_AWARD", name: "Pre award" }],
        stage: "Assessment",
        status: null,
      });
      expect(unnamed.header.names).toBeNull();
    },
  );

  it("answers 404 APPLICATION_NOT_FOUND for an unknown application, audited as a FAILURE", async () => {
    const error = await getTab("overview", "nobody").catch((e) => e);

    expect(error.output.statusCode).toBe(404);
    expect(error.data.payload.reason).toBe("APPLICATION_NOT_FOUND");

    const [row] = await auditRows("VIEW_APPLICATION");
    expect(row.event.audit.status).toBe("failure");
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
      user: `AAD/${OID}`,
      security: { pmccode: "0706" },
      audit: {
        status: "success",
        entities: [
          {
            entity: "APPLICATION",
            action: "VIEW_APPLICATION",
            entityid: "ref-1",
          },
        ],
        details: { tab: "raw", code: "woodland" },
        accounts: { sbi: "900000005", frn: "9100000006", crn: "9000000006" },
      },
    });
    expect(JSON.stringify(rows[0].event)).not.toContain("AA0109-0118");
  });

  it("answers 500 with no data when the audit cannot be committed", async () => {
    // An audit entity id is at most 120 characters, so this view's audit is refused.
    const clientRef = "r".repeat(121);
    await applications.insertOne(anApplication(clientRef));

    const error = await getTab("raw", clientRef).catch((e) => e);

    expect(error.output.statusCode).toBe(500);
    expect(JSON.stringify(error.data.payload)).not.toContain("AA0109-0118");
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
    expect(row.event.user).toBe(`AAD/${OID}`);
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

    const [request] = await cwStubRequestsBesideCatalogue();
    expect(request.actorId).toBe(OID);
  });
});

describe("the same Client Reference in two grants", () => {
  const REF = `client-wmp-test-${randomUUID()}`;
  const GRANTS = ["test-code-1", "test-code-2"];

  const grantOf = ({ data, eventData }) =>
    data?.code ??
    data?.grantCode ??
    data?.workflowCode ??
    eventData?.applicationType;

  // The rows each grant's writers wrote, read from the stored envelopes.
  const storedRowsOf = async (code) => {
    const rows = [
      ...(await outbox.find().toArray()),
      ...(await inbox.find().toArray()),
    ];

    return rows
      .filter(({ event }) => grantOf(event) === code)
      .map(({ _id, eventType }) => ({ id: _id.toString(), type: eventType }))
      .sort((a, b) => a.id.localeCompare(b.id));
  };

  const shownRowsOf = async (code) => {
    const { payload: page } = await getTab("events", REF, code);

    return page.events.rows
      .map(({ id, type }) => ({ id, type }))
      .sort((a, b) => a.id.localeCompare(b.id));
  };

  const caseStatusUpdated = (code) =>
    sendMessage(env.GAS__SQS__UPDATE_STATUS_QUEUE_URL, {
      id: randomUUID(),
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      type: "cloud.defra.local.fg-cw-backend.case.status.updated",
      source: "CW",
      data: {
        caseRef: REF,
        workflowCode: code,
        previousStatus: "APPLICATION_RECEIVED",
        currentStatus: "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
      },
    });

  const settled = () =>
    vi.waitUntil(
      async () =>
        (await inbox.countDocuments({
          status: { $in: ["COMPLETED", "FAILED", "DEAD_LETTER"] },
        })) === GRANTS.length,
      { timeout: 10_000, interval: 200 },
    );

  it("events: either application's tab shows that grant's events and no other's", async () => {
    for (const code of GRANTS) {
      await createGrant(code);
      await submitApplication(db, { code, clientRef: REF });
      await caseStatusUpdated(code);
    }
    await settled();

    const [first, second] = await Promise.all(GRANTS.map(storedRowsOf));

    for (const [code, stored] of [
      [GRANTS[0], first],
      [GRANTS[1], second],
    ]) {
      expect(stored.map(({ type }) => type)).toEqual(
        expect.arrayContaining([
          "ApplicationCreated",
          "ApplicationCreatedReport",
          "CreateCase",
          "CaseStatusUpdated",
        ]),
      );
      expect(await shownRowsOf(code)).toEqual(stored);
    }
    expect(
      first.filter(({ id }) => second.some((row) => row.id === id)),
    ).toEqual([]);
  });
});
