import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

let client;
let inbox;
let outbox;

const breakdown = (query) =>
  wreck.get(
    query
      ? `/grant-admin/events/breakdown?${new URLSearchParams(query)}`
      : "/grant-admin/events/breakdown",
  );

const groupFor = (groups, error, type) =>
  groups.find(
    (group) => group.error === error && (!type || group.type === type),
  );

const seg = () => `BD-${new ObjectId().toHexString()}`;

const aDeadInboxDoc = (overrides = {}) => ({
  _id: new ObjectId(),
  messageId: `msg-bd-${new ObjectId().toHexString()}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  segregationRef: seg(),
  status: "DEAD_LETTER",
  completionAttempts: 5,
  eventTime: "2026-06-16T10:00:00.000Z",
  publicationDate: "2026-06-16T10:00:01.000Z",
  lastResubmissionDate: "2026-06-16T10:05:00.000Z",
  completionDate: null,
  lastError: { name: "Error", message: "No handler found", at: null },
  attemptHistory: [],
  lastRedrive: null,
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  event: { id: "evt-bd", time: "2026-06-16T10:00:00.000Z", data: {} },
  ...overrides,
});

const aDeadOutboxDoc = (overrides = {}) => ({
  _id: new ObjectId(),
  target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case.fifo",
  segregationRef: seg(),
  status: "DEAD_LETTER",
  completionAttempts: 5,
  publicationDate: new Date("2026-06-16T10:00:00.000Z"),
  lastResubmissionDate: "2026-06-16T10:05:00.000Z",
  completionDate: null,
  lastError: { name: "Error", message: "publish failed", at: null },
  attemptHistory: [],
  lastRedrive: null,
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  event: {
    id: `evt-bd-${new ObjectId().toHexString()}`,
    type: "cloud.defra.local.fg-gas-backend.case.create.new",
    time: "2026-06-16T10:00:00.000Z",
    data: {},
  },
  ...overrides,
});

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
  await inbox.deleteMany({ messageId: /^msg-bd-/ });
  await outbox.deleteMany({ "event.id": /^evt-bd-/ });
});

describe("GET /grant-admin/events/breakdown", () => {
  it("groups GAS dead letters by failure message and short event type", async () => {
    const ref = seg();
    await inbox.insertMany([
      aDeadInboxDoc({ segregationRef: ref }),
      aDeadInboxDoc({ segregationRef: ref }),
    ]);

    const { payload } = await breakdown({ q: ref });

    expect(payload.groups).toEqual([
      {
        error: "No handler found",
        // the namespace is stripped here, exactly as it is on a list row
        type: "case.status.updated",
        count: 2,
        firstAt: "2026-06-16T10:00:00.000Z",
        lastAt: "2026-06-16T10:00:00.000Z",
      },
    ]);
    expect(payload.sourceErrors).toEqual([]);
  });

  it("takes firstAt and lastAt from the box's own sort key", async () => {
    const ref = seg();
    await inbox.insertMany([
      aDeadInboxDoc({
        segregationRef: ref,
        eventTime: "2026-06-16T09:00:00.000Z",
      }),
      aDeadInboxDoc({
        segregationRef: ref,
        eventTime: "2026-06-16T12:00:00.000Z",
      }),
    ]);

    const { payload } = await breakdown({ q: ref });

    expect(payload.groups[0].firstAt).toBe("2026-06-16T09:00:00.000Z");
    expect(payload.groups[0].lastAt).toBe("2026-06-16T12:00:00.000Z");
  });

  it("keeps a null-error group for a row dead-lettered before any error was recorded", async () => {
    const ref = seg();
    await inbox.insertOne(
      aDeadInboxDoc({ segregationRef: ref, lastError: null }),
    );

    const { payload } = await breakdown({ q: ref });

    expect(payload.groups).toEqual([
      expect.objectContaining({ error: null, count: 1 }),
    ]);
  });

  it("counts an outbox row under its own stored event.type", async () => {
    const ref = seg();
    await outbox.insertOne(aDeadOutboxDoc({ segregationRef: ref }));

    const { payload } = await breakdown({ q: ref });

    expect(payload.groups).toEqual([
      expect.objectContaining({
        error: "publish failed",
        type: "case.create.new",
        count: 1,
      }),
    ]);
  });

  it("counts only DEAD_LETTER rows", async () => {
    const ref = seg();
    await inbox.insertMany([
      aDeadInboxDoc({ segregationRef: ref }),
      aDeadInboxDoc({ segregationRef: ref, status: "COMPLETED" }),
      aDeadInboxDoc({ segregationRef: ref, status: "FAILED" }),
    ]);

    const { payload } = await breakdown({ q: ref });

    expect(payload.groups[0].count).toBe(1);
  });

  it("merges GAS and Caseworking groups that shorten to the same type", async () => {
    const ref = seg();
    await inbox.insertOne(aDeadInboxDoc({ segregationRef: ref }));
    await setCwStub({
      inbox: {
        groups: [
          {
            error: "No handler found",
            type: "cloud.defra.prd.fg-cw-backend.case.status.updated",
            count: 4,
            firstAt: "2026-06-16T08:00:00.000Z",
            lastAt: "2026-06-16T13:00:00.000Z",
          },
        ],
      },
    });

    const { payload } = await breakdown({ q: ref });

    expect(groupFor(payload.groups, "No handler found")).toEqual({
      error: "No handler found",
      type: "case.status.updated",
      count: 5,
      firstAt: "2026-06-16T08:00:00.000Z",
      lastAt: "2026-06-16T13:00:00.000Z",
    });
  });

  it("sorts commonest first and caps the answer at twenty groups", async () => {
    await setCwStub({
      inbox: {
        groups: Array.from({ length: 30 }, (_, index) => ({
          error: `error-${index}`,
          type: "cloud.defra.prd.svc.case.create",
          count: index + 1,
          firstAt: null,
          lastAt: null,
        })),
      },
    });

    const { payload } = await breakdown({ service: "caseworking" });

    expect(payload.groups).toHaveLength(20);
    expect(payload.groups[0].count).toBe(30);
    expect(payload.groups.at(-1).count).toBe(11);
  });

  it("reads only GAS with service=gas, and never calls Caseworking", async () => {
    const ref = seg();
    await inbox.insertOne(aDeadInboxDoc({ segregationRef: ref }));
    await setCwStub({
      inbox: { groups: [{ error: "cw only", type: "t", count: 9 }] },
    });

    const { payload } = await breakdown({ service: "gas", q: ref });

    expect(groupFor(payload.groups, "cw only")).toBeUndefined();
  });

  it("degrades to a partial answer with a sourceError when Caseworking is down", async () => {
    const ref = seg();
    await inbox.insertOne(aDeadInboxDoc({ segregationRef: ref }));
    await setCwStub({ inbox: { mode: "error" }, outbox: { mode: "error" } });

    const { payload } = await breakdown({ q: ref });

    expect(payload.groups[0].count).toBe(1);
    expect(payload.sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "HTTP 500" },
      { service: "caseworking", box: "outbox", message: "HTTP 500" },
    ]);
  });

  it("never leaks a Caseworking response body into a sourceError", async () => {
    await setCwStub({ inbox: { mode: "unauthorized" } });

    const { payload } = await breakdown({});

    expect(JSON.stringify(payload)).not.toContain("SECRET-CW-401-BODY");
  });

  it("rejects a status with 400 - the scope is always DEAD_LETTER", async () => {
    await expect(breakdown({ status: "FAILED" })).rejects.toThrow(
      "Response Error: 400 Bad Request",
    );
  });

  it("rejects an error filter with 400", async () => {
    await expect(breakdown({ error: "boom" })).rejects.toThrow(
      "Response Error: 400 Bad Request",
    );
  });

  it("rejects a reversed range with 400", async () => {
    await expect(
      breakdown({
        from: "2026-06-17T00:00:00.000Z",
        to: "2026-06-16T00:00:00.000Z",
      }),
    ).rejects.toThrow("Response Error: 400 Bad Request");
  });

  it("reaches the breakdown route rather than the detail route", async () => {
    const { payload } = await breakdown({});

    expect(payload).toHaveProperty("groups");
  });
});

describe("the error filter and the breakdown agree", () => {
  it("filters the list to exactly the rows one breakdown group counts", async () => {
    const ref = seg();
    await inbox.insertMany([
      aDeadInboxDoc({ segregationRef: ref }),
      aDeadInboxDoc({ segregationRef: ref }),
      aDeadInboxDoc({
        segregationRef: ref,
        lastError: { name: "TypeError", message: "boom", at: null },
      }),
    ]);

    const { payload: groups } = await breakdown({ q: ref });
    const group = groupFor(groups.groups, "No handler found");

    const { payload: page } = await wreck.get(
      `/grant-admin/events?${new URLSearchParams({
        q: ref,
        error: "No handler found",
      })}`,
    );

    expect(page.events).toHaveLength(group.count);
    expect(
      page.events.every((row) => row.lastError.message === "No handler found"),
    ).toBe(true);
  });

  it("matches exactly, so a prefix of the message selects nothing", async () => {
    const ref = seg();
    await inbox.insertOne(aDeadInboxDoc({ segregationRef: ref }));

    const { payload } = await wreck.get(
      `/grant-admin/events?${new URLSearchParams({
        q: ref,
        error: "No handler",
      })}`,
    );

    expect(payload.events).toHaveLength(0);
  });

  it("narrows the counts the same way", async () => {
    const ref = seg();
    await inbox.insertMany([
      aDeadInboxDoc({ segregationRef: ref }),
      aDeadInboxDoc({
        segregationRef: ref,
        lastError: { name: "TypeError", message: "boom", at: null },
      }),
    ]);

    const { payload } = await wreck.get(
      `/grant-admin/events/counts?${new URLSearchParams({
        q: ref,
        error: "No handler found",
      })}`,
    );

    expect(payload.counts.DEAD_LETTER).toBe(1);
  });

  it("forwards the error filter to Caseworking", async () => {
    await wreck.get(
      `/grant-admin/events?${new URLSearchParams({ error: "boom" })}`,
    );

    const { cwStubRequests } = await import("../helpers/cw-stub.js");
    const requests = await cwStubRequests();

    expect(requests.some((r) => r.query.error === "boom")).toBe(true);
  });
});
