import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { countEventsResponseSchema } from "../../src/grant-admin/schemas/count-events-response.schema.js";
import { cwStubRequests, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

let client;
let inbox;
let outbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  inbox = client.db().collection("inbox");
  outbox = client.db().collection("outbox");
});

afterAll(async () => {
  await client?.close();
});

beforeEach(async () => {
  await resetCwStub();
});

const ZERO = {
  PUBLISHED: 0,
  PROCESSING: 0,
  FAILED: 0,
  RESUBMITTED: 0,
  COMPLETED: 0,
  DEAD_LETTER: 0,
};

const counts = (overrides = {}) => ({ ...ZERO, ...overrides });

// Only statuses the running pollers leave alone: PUBLISHED, FAILED and
// RESUBMITTED rows are rewritten mid-test by the claim and resubmit sweeps.
const at = (minute) =>
  new Date(Date.UTC(2026, 5, 16, 10, minute)).toISOString();

const inboxDoc = (n, overrides = {}) => ({
  messageId: `msg-count-${n}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  status: "COMPLETED",
  completionAttempts: 1,
  eventTime: at(n),
  publicationDate: at(n),
  lastResubmissionDate: null,
  completionDate: at(n),
  segregationRef: `COUNT-${n}`,
  event: { id: `evt-count-${n}`, time: at(n), data: { clientRef: "REF" } },
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  ...overrides,
});

const outboxDoc = (n, overrides = {}) => ({
  target:
    "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case_fifo.fifo",
  status: "COMPLETED",
  completionAttempts: 1,
  publicationDate: new Date(Date.UTC(2026, 5, 16, 10, n)),
  lastResubmissionDate: null,
  completionDate: at(n),
  segregationRef: `COUNT-${n}`,
  event: {
    id: `evt-count-${n}`,
    type: "cloud.defra.local.fg-gas-backend.case.create",
    time: at(n),
    data: { clientRef: "REF" },
  },
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  ...overrides,
});

const countEvents = async (query = "", options = {}) => {
  const { payload } = await wreck.get(
    `/grant-admin/events/counts${query}`,
    options,
  );

  return payload;
};

const findEvents = async (query = "") => {
  const { payload } = await wreck.get(`/grant-admin/events${query}`);

  return payload;
};

// The service's own audit topic - the second of the two shapes an audit outbox
// row can take (see common/event-list-filter.js). Matches the ARN the
// integration environment configures.
const AUDIT_ARN =
  "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn";

// An audit row announces itself by its payload, by its target, or by both, and
// real data has all three shapes. None of them is counted specially any more -
// the TYPE facet is gone, and an audit row is counted like any other row.
const auditByPayload = (n) =>
  outboxDoc(n, { event: { ...outboxDoc(n).event, audit: { action: "VIEW" } } });

const auditByTarget = (n) => outboxDoc(n, { target: AUDIT_ARN });

const auditByBoth = (n) =>
  outboxDoc(n, {
    target: AUDIT_ARN,
    event: { ...outboxDoc(n).event, audit: { action: "VIEW" } },
  });

// Two GAS domain rows (one inbox, one outbox) and three GAS audit rows, one of
// each shape. Caseworking's numbers come from the stub.
const seedMixedGas = async () => {
  await inbox.insertMany([inboxDoc(1), inboxDoc(2, { status: "DEAD_LETTER" })]);
  await outbox.insertMany([
    outboxDoc(3),
    auditByPayload(4),
    auditByTarget(5),
    auditByBoth(6),
  ]);
};

// What the caller does with the block, and what the events page's total
// indicator renders: the seven numbers added up. It used to arrive as a
// `total` beside them, which could only ever agree with them or be a bug.
const totalOf = (body) =>
  Object.values(body.counts).reduce((sum, n) => sum + n, 0);

describe("GET /grant-admin/events/counts", () => {
  it("answers with every block at zero for an empty estate", async () => {
    const body = await countEvents();

    expect(body).toEqual({
      counts: ZERO,
      sourceErrors: [],
    });
    expect(countEventsResponseSchema.validate(body).error).toBeUndefined();
  });

  it("is not read as an event id by the detail route", async () => {
    const body = await countEvents();

    expect(body).toHaveProperty("counts");
    expect(body).not.toHaveProperty("payload");
  });

  it("counts GAS inbox and outbox rows per status", async () => {
    await inbox.insertMany([
      inboxDoc(1),
      inboxDoc(2),
      inboxDoc(3, { status: "DEAD_LETTER" }),
    ]);
    await outbox.insertMany([
      outboxDoc(4, { status: "DEAD_LETTER" }),
      outboxDoc(5, { status: "PROCESSING", claimExpiresAt: new Date(2099, 0) }),
    ]);

    expect((await countEvents()).counts).toEqual(
      counts({ COMPLETED: 2, DEAD_LETTER: 2, PROCESSING: 1 }),
    );
  });

  it("sums GAS and Caseworking into one set of counts", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({
      inbox: { counts: counts({ DEAD_LETTER: 3 }) },
      outbox: { counts: counts({ COMPLETED: 7, FAILED: 1 }) },
    });

    expect((await countEvents()).counts).toEqual(
      counts({ COMPLETED: 8, DEAD_LETTER: 3, FAILED: 1 }),
    );
  });

  // Caseworking is not read at all under service=gas. It used to be, because
  // the `byService` block had to answer for the service the operator had not
  // selected; that block is gone, so counting a service nobody asked about
  // would be a collection scan for a number nothing renders.
  it("counts only GAS with service=gas, and never reads Caseworking", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({ inbox: { counts: counts({ DEAD_LETTER: 3 }) } });

    const body = await countEvents("?service=gas");

    expect(body.counts).toEqual(counts({ COMPLETED: 1 }));
    expect(totalOf(body)).toBe(1);
    expect(await cwStubRequests()).toEqual([]);
  });

  it("counts only Caseworking with service=caseworking", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({ inbox: { counts: counts({ DEAD_LETTER: 3 }) } });

    expect((await countEvents("?service=caseworking")).counts).toEqual(
      counts({ DEAD_LETTER: 3 }),
    );
  });

  it("applies q to both services", async () => {
    await inbox.insertMany([inboxDoc(1), inboxDoc(2)]);

    const body = await countEvents("?q=COUNT-1");

    expect(body.counts).toEqual(counts({ COMPLETED: 1 }));

    const requests = await cwStubRequests();

    expect(requests.map((request) => request.query.q)).toEqual([
      "COUNT-1",
      "COUNT-1",
    ]);
  });

  it("applies from and to, and forwards them to Caseworking", async () => {
    await inbox.insertMany([inboxDoc(10), inboxDoc(20), inboxDoc(30)]);
    await outbox.insertOne(outboxDoc(15));

    const body = await countEvents(`?from=${at(15)}&to=${at(25)}`);

    expect(body.counts).toEqual(counts({ COMPLETED: 2 }));

    for (const request of await cwStubRequests()) {
      expect(request.query.from).toBe(at(15));
      expect(request.query.to).toBe(at(25));
    }
  });

  it("hits /actuators/{box}/counts on Caseworking, with the bearer token", async () => {
    await countEvents();

    const requests = await cwStubRequests();

    expect(requests.map((request) => request.path).sort()).toEqual([
      "/actuators/inbox/counts",
      "/actuators/outbox/counts",
    ]);
    expect(requests[0].authorization).toBe("Bearer cw-stub-token");
  });

  it("contributes zeros and a sourceError when Caseworking is down", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({ inbox: { mode: "down" }, outbox: { mode: "error" } });
    // a destroyed socket surfaces as wreck's own 502, a 500 as HTTP 500

    const body = await countEvents();

    expect(body.counts).toEqual(counts({ COMPLETED: 1 }));
    expect(body.sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "HTTP 502" },
      { service: "caseworking", box: "outbox", message: "HTTP 500" },
    ]);
    expect(countEventsResponseSchema.validate(body).error).toBeUndefined();
  });

  it("never leaks a Caseworking response body into a sourceError", async () => {
    await setCwStub({ inbox: { mode: "unauthorized" } });

    const body = await countEvents();

    expect(JSON.stringify(body)).not.toContain("SECRET-CW-401-BODY");
    expect(body.sourceErrors[0].message).toBe("HTTP 401");
  });

  it("400s on a status, which the endpoint deliberately does not accept", async () => {
    await expect(countEvents("?status=FAILED")).rejects.toThrow(
      "Response Error: 400 Bad Request",
    );
  });

  it("400s on a cursor and on from after to", async () => {
    await expect(countEvents("?cursor=abc")).rejects.toThrow(
      "Response Error: 400 Bad Request",
    );
    await expect(countEvents(`?from=${at(30)}&to=${at(10)}`)).rejects.toThrow(
      "Response Error: 400 Bad Request",
    );
  });

  it("401s without a valid service bearer token", async () => {
    await expect(
      countEvents("", {
        headers: {
          authorization: "Bearer 11111111-1111-1111-1111-111111111111",
        },
      }),
    ).rejects.toMatchObject({ output: { statusCode: 401 } });
  });
});

// ---------------------------------------------------------------------------
// The three facets. Each block is computed with its OWN filter excluded and
// every other filter applied, so a selected segment in the frontend's filter
// bar still shows its siblings' true numbers.
// ---------------------------------------------------------------------------

describe("GET /grant-admin/events/counts - facets", () => {
  it("counts every source it read when nothing is filtered", async () => {
    await seedMixedGas();
    await setCwStub({
      inbox: { counts: counts({ DEAD_LETTER: 3 }) },
      outbox: { counts: counts({ COMPLETED: 5 }) },
    });

    const body = await countEvents();

    expect(totalOf(body)).toBe(14);
    expect(countEventsResponseSchema.validate(body).error).toBeUndefined();
  });

  // One block and its errors. `total` was the seven numbers in `counts` added
  // up and sent beside them, so it could only ever agree with them or be a
  // bug; the caller adds them up. The two service-shaped blocks went before it.
  it("answers with counts and sourceErrors and nothing else", async () => {
    await seedMixedGas();

    const body = await countEvents();

    expect(body).not.toHaveProperty("total");
    expect(body).not.toHaveProperty("byService");
    expect(body).not.toHaveProperty("byKind");
    expect(Object.keys(body).sort()).toEqual(["counts", "sourceErrors"]);
  });

  it.each([
    ["kind=audit", "?kind=audit"],
    ["kind=domain", "?service=gas&kind=domain"],
    ["an unknown kind", "?kind=other"],
    ["an empty kind", "?kind="],
  ])("responds 400 for %s", async (_name, query) => {
    await expect(countEvents(query)).rejects.toMatchObject({
      output: { statusCode: 400 },
    });
  });

  it("counts audit rows into the status counts like any other row", async () => {
    await seedMixedGas();

    const body = await countEvents("?service=gas");

    expect(body.counts).toEqual(counts({ COMPLETED: 5, DEAD_LETTER: 1 }));
    expect(totalOf(body)).toBe(6);
  });

  it("narrows the counts by q and by the time range", async () => {
    await inbox.insertMany([inboxDoc(10), inboxDoc(20)]);
    await outbox.insertMany([auditByPayload(15), auditByTarget(30)]);

    expect(totalOf(await countEvents("?service=gas&q=COUNT-10"))).toBe(1);
    expect(
      totalOf(await countEvents(`?service=gas&from=${at(12)}&to=${at(25)}`)),
    ).toBe(2);
  });

  it("counts exactly the rows the list returns, on all three audit shapes", async () => {
    await seedMixedGas();

    const body = await countEvents("?service=gas");
    const listed = await findEvents("?service=gas");

    expect(totalOf(body)).toBe(listed.events.length);
  });

  it("reads each Caseworking box in ONE call, with no kind on it", async () => {
    await countEvents("?q=GLD-9B2");

    const requests = await cwStubRequests();

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.path).sort()).toEqual([
      "/actuators/inbox/counts",
      "/actuators/outbox/counts",
    ]);
    expect(requests.every((request) => !("kind" in request.query))).toBe(true);
  });

  it("forwards the error filter to Caseworking as well", async () => {
    await countEvents("?error=boom");

    for (const request of await cwStubRequests()) {
      expect(request.query.error).toBe("boom");
    }
  });

  it("contributes zeros when Caseworking is down, and says so", async () => {
    await seedMixedGas();
    await setCwStub({ inbox: { mode: "down" }, outbox: { mode: "error" } });

    const body = await countEvents();

    expect(totalOf(body)).toBe(6);
    expect(body.sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "HTTP 502" },
      { service: "caseworking", box: "outbox", message: "HTTP 500" },
    ]);
    expect(countEventsResponseSchema.validate(body).error).toBeUndefined();
  });

  // Back in step with the list, which has always selected this way: under
  // `?service=gas` Caseworking is not part of the answer, so a broken
  // Caseworking is not a gap in it and is not reported as one.
  it("reports no Caseworking failure under service=gas, which does not read it", async () => {
    await seedMixedGas();
    await setCwStub({ inbox: { mode: "down" }, outbox: { mode: "down" } });

    const body = await countEvents("?service=gas");

    expect(totalOf(body)).toBe(6);
    expect(body.sourceErrors).toEqual([]);
  });

  it("reads a Caseworking answer with no counts as zeros, not as a failure", async () => {
    await setCwStub({ inbox: { counts: counts({ DEAD_LETTER: 4 }) } });

    const body = await countEvents();

    expect(body.counts).toEqual(counts({ DEAD_LETTER: 4 }));
    expect(body.sourceErrors).toEqual([]);
  });
});
