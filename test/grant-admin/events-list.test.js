import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OPERATOR = { "x-actor": "Jo Operator", "x-actor-id": OID };
const BASE = Date.UTC(2026, 9, 15, 10);

let client;
let outbox;
let inbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db();
  outbox = db.collection("outbox");
  inbox = db.collection("inbox");
});

afterAll(async () => {
  await client?.close();
});

beforeEach(async () => {
  await resetCwStub();
});

const hex = (n) => n.toString(16).padStart(24, "0");

// The outbox keeps its time as a Date, the inbox as ISO text.
const anOutboxRow = (n, ms, overrides = {}) => ({
  _id: ObjectId.createFromHexString(hex(n)),
  target: "arn:aws:sns:eu-west-2:000000000000:create_new_case",
  segregationRef: `events-list-${n}`,
  status: "COMPLETED",
  completionAttempts: 0,
  publicationDate: new Date(BASE - ms),
  claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  event: { id: `evt-${n}`, data: {} },
  eventType: "CreateCase",
  refs: [`id:evt-${n}`],
  ...overrides,
});

const anInboxRow = (n, ms, overrides = {}) => ({
  _id: ObjectId.createFromHexString(hex(n)),
  source: "CW",
  segregationRef: `events-list-${n}`,
  status: "COMPLETED",
  publicationDate: new Date(BASE - ms).toISOString(),
  claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  messageId: `msg-${n}`,
  event: { data: {} },
  eventType: "CaseStatusUpdated",
  refs: [`id:msg-${n}`],
  ...overrides,
});

const listQuery = async (payload) =>
  (
    await wreck.post("/grant-admin/lists/query", {
      payload: { path: "events/gas", params: {}, ...payload },
      headers: OPERATOR,
      timeout: 20_000,
    })
  ).payload;

const wayOn = ({ page }) => page.next ?? page.keepLooking;

const walk = async (params) => {
  const pages = [(await listQuery({ params, count: true })).list];

  while (wayOn(pages.at(-1)) !== null) {
    pages.push((await listQuery({ params, cursor: wayOn(pages.at(-1)) })).list);
  }

  return pages;
};

const shown = (pages) =>
  pages.flatMap(({ rows }) =>
    rows.map(({ id, cells }) => `${cells.box}:${id}`),
  );

const compare = (a, b) => (a === b ? 0 : a < b ? -1 : 1);

// Both boxes read straight from the collections and sorted newest first:
// at one time, the inbox first, then the newest id.
const directly = async (filter = {}) => {
  const read = async (collection, box) =>
    (await collection.find(filter).toArray()).map(
      ({ _id, publicationDate }) => ({
        t: new Date(publicationDate).toISOString(),
        box,
        bucket: `gas.${box}`,
        i: _id.toHexString(),
      }),
    );
  const rows = [
    ...(await read(outbox, "outbox")),
    ...(await read(inbox, "inbox")),
  ];

  return rows
    .sort(
      (a, b) =>
        compare(b.t, a.t) || compare(a.bucket, b.bucket) || compare(b.i, a.i),
    )
    .map(({ box, i }) => `${box}:${i}`);
};

describe("GAS events as one list over its outbox and inbox", () => {
  it("walks both boxes newest first, through times and ids they share, as a direct sort does", async () => {
    await outbox.insertMany(
      Array.from({ length: 45 }, (_, n) => anOutboxRow(n, Math.floor(n / 4))),
    );
    await inbox.insertMany(
      Array.from({ length: 38 }, (_, n) =>
        anInboxRow(n + 20, Math.floor(n / 3)),
      ),
    );

    const pages = await walk({});

    expect(shown(pages)).toEqual(await directly());
    expect(pages.map(({ rows }) => rows.length)).toEqual([20, 20, 20, 20, 3]);
    expect(pages[0].total).toEqual({ count: 83, capped: false });
    expect(pages.every(({ plan }) => plan.kind === "exact")).toBe(true);
  });

  it("restores pages 1 to N as the walk showed them", async () => {
    await outbox.insertMany(
      Array.from({ length: 30 }, (_, n) => anOutboxRow(n, n % 7)),
    );
    await inbox.insertMany(
      Array.from({ length: 30 }, (_, n) => anInboxRow(n, n % 5)),
    );
    const pages = await walk({});

    const { list } = await listQuery({ params: {}, pages: 3, count: true });

    expect(list.pageRows).toEqual([20, 20, 20]);
    expect(shown([list])).toEqual(shown(pages));
  });

  it("reads one queue picked, and nothing for an event outside it", async () => {
    await outbox.insertMany([anOutboxRow(1, 1), anOutboxRow(2, 2)]);
    await inbox.insertMany([anInboxRow(3, 3)]);

    const inboxOnly = await listQuery({
      params: { queue: "inbox" },
      count: true,
    });
    const nothing = await listQuery({
      params: { queue: "inbox", event: "Audit" },
      count: true,
    });

    expect(shown([inboxOnly.list])).toEqual([`inbox:${hex(3)}`]);
    expect(nothing.list).toMatchObject({
      rows: [],
      total: { count: 0, capped: false },
      page: { complete: true },
      queues: { limited: [], waiting: [] },
    });
  });

  it.each([
    ["an error key", { error: "Grant <v> not found" }],
    ["an error name", { errorname: "TypeError" }],
  ])(
    "reads %s alone exactly in both boxes, with a total",
    async (_, params) => {
      const dead = {
        status: "DEAD_LETTER",
        lastError: { name: "TypeError", message: "x" },
        errorKey: "Grant <v> not found",
      };
      await outbox.insertMany([anOutboxRow(1, 1, dead), anOutboxRow(2, 2)]);
      await inbox.insertMany([anInboxRow(3, 3, dead)]);

      const { list } = await listQuery({ params, count: true });
      const outboxOnly = await listQuery({
        params: { ...params, queue: "outbox" },
        count: true,
      });

      expect(list.plan.kind).toBe("exact");
      expect(list.total).toEqual({ count: 2, capped: false });
      expect(outboxOnly.list.plan.kind).toBe("exact");
      expect(shown([outboxOnly.list])).toEqual([`outbox:${hex(1)}`]);
    },
  );

  it("walks an error name and key no line holds together a window at a time, in order", async () => {
    const candidate = (n) =>
      anOutboxRow(n, n, {
        status: "DEAD_LETTER",
        lastError: { name: "TypeError", message: "x" },
        errorKey: n % 9_000 === 7 ? "Hit <v>" : "Miss <v>",
      });
    await outbox.insertMany(
      Array.from({ length: 70_000 }, (_, n) => candidate(n)),
    );
    await inbox.insertMany(
      [5, 25_000, 61_000].map((ms, k) =>
        anInboxRow(100_000 + k, ms, {
          status: "DEAD_LETTER",
          lastError: { name: "TypeError", message: "x" },
          errorKey: "Hit <v>",
        }),
      ),
    );
    const params = { errorname: "TypeError", error: "Hit <v>" };

    const pages = await walk(params);

    expect(shown(pages)).toEqual(
      await directly({ "lastError.name": "TypeError", errorKey: "Hit <v>" }),
    );
    expect(
      pages.filter(({ page }) => page.keepLooking).length,
    ).toBeGreaterThanOrEqual(3);
    expect(pages[0]).toMatchObject({ plan: { kind: "bounded" }, total: null });
    expect(pages.at(-1).page.complete).toBe(true);
    expect(pages.at(-1).plan.kind).toBe("bounded");
  }, 120_000);

  it("answers the key of no recorded error beside an error name with no read", async () => {
    const { list } = await listQuery({
      params: { errorname: "TypeError", error: "No error recorded" },
      count: true,
    });

    expect(list).toMatchObject({
      rows: [],
      total: { count: 0, capped: false },
      page: { complete: true },
    });
  });

  it("refuses a search no box may take, reading the list without it", async () => {
    await outbox.insertMany([anOutboxRow(1, 1)]);

    const { list } = await listQuery({ params: {}, search: "config:x" });

    expect(list.refusedSearch).toEqual({
      refusal:
        "The search names an identifier kind this bucket does not declare",
    });
    expect(list.rows).toHaveLength(1);
  });
});
