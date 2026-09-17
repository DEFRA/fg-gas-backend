import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../../src/common/config.js";
import { updateDeadEvents as sweepInbox } from "../../src/grants/repositories/inbox.repository.js";
import { updateDeadEvents as sweepOutbox } from "../../src/grants/repositories/outbox.repository.js";

// The sweep counts FAILURES, not attempts: `markAsComplete` never increments
// `completionAttempts`, and a row at the cap can never be claimed again. So a
// row that succeeded lands at cap-1 and no normal run puts a COMPLETED row at
// the cap. Lowering INBOX_MAX_RETRIES/OUTBOX_MAX_RETRIES does: every row that
// succeeded after that many failures is suddenly at or above the new cap.
// These rows are seeded above the cap for exactly that reason - at the cap
// alone the case is unreachable and the test would be vacuous.

const INBOX_CAP = config.inbox.inboxMaxRetries;
const OUTBOX_CAP = config.outbox.outboxMaxRetries;

// The container reads .env (retries = 5), not test/vitest.config.js. Seeding
// above both caps is what a lowered cap looks like, and it also keeps the
// containerised poller from claiming a row out from under the assertions.
const CONTAINER_CAP = 5;
const ABOVE_CAP = Math.max(INBOX_CAP, OUTBOX_CAP, CONTAINER_CAP) + 1;

const SWEPT_STATUSES = ["PUBLISHED", "FAILED", "RESUBMITTED", "PROCESSING"];

let client;
let inbox;
let outbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db();
  inbox = db.collection("inbox");
  outbox = db.collection("outbox");
});

afterAll(async () => {
  await client?.close();
});

const anInboxRow = (status, completionAttempts) => ({
  _id: new ObjectId(),
  messageId: `msg-${new ObjectId().toHexString()}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  // Unique, so the running poller cannot claim it mid-test.
  segregationRef: `SWEEP-${new ObjectId().toHexString()}`,
  status,
  completionAttempts,
  completionDate: status === "COMPLETED" ? "2026-06-16T10:05:00.000Z" : null,
  publicationDate: "2026-06-16T10:00:00.000Z",
  eventTime: "2026-06-16T10:00:00.000Z",
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  event: { id: "evt-1", time: "2026-06-16T10:00:00.000Z", data: {} },
});

const anOutboxRow = (status, completionAttempts) => ({
  _id: new ObjectId(),
  target:
    "arn:aws:sns:eu-west-2:000000000000:cw__sns__create_new_case_fifo.fifo",
  segregationRef: `SWEEP-${new ObjectId().toHexString()}`,
  status,
  completionAttempts,
  completionDate: status === "COMPLETED" ? "2026-06-16T10:05:00.000Z" : null,
  publicationDate: new Date("2026-06-16T10:00:00.000Z"),
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  event: { id: "evt-1", time: "2026-06-16T10:00:00.000Z", data: {} },
});

const statusOf = async (collection, id) =>
  (await collection.findOne({ _id: id }))?.status;

describe("inbox dead-letter sweep", () => {
  it("leaves a COMPLETED row at the cap alone", async () => {
    const row = anInboxRow("COMPLETED", INBOX_CAP);
    await inbox.insertOne(row);

    await sweepInbox();

    expect(await statusOf(inbox, row._id)).toBe("COMPLETED");
  });

  it("leaves a COMPLETED row above a lowered cap alone", async () => {
    const row = anInboxRow("COMPLETED", ABOVE_CAP);
    await inbox.insertOne(row);

    await sweepInbox();

    expect(await statusOf(inbox, row._id)).toBe("COMPLETED");
  });

  it.each(SWEPT_STATUSES)(
    "dead-letters a %s row at or above the cap",
    async (status) => {
      const row = anInboxRow(status, ABOVE_CAP);
      await inbox.insertOne(row);

      await sweepInbox();

      expect(await statusOf(inbox, row._id)).toBe("DEAD_LETTER");
    },
  );

  it("does not rewrite a row that is already DEAD_LETTER", async () => {
    await inbox.insertOne(anInboxRow("DEAD_LETTER", ABOVE_CAP));

    const { modifiedCount } = await sweepInbox();

    expect(modifiedCount).toBe(0);
  });
});

describe("outbox dead-letter sweep", () => {
  it("leaves a COMPLETED row at the cap alone", async () => {
    const row = anOutboxRow("COMPLETED", OUTBOX_CAP);
    await outbox.insertOne(row);

    await sweepOutbox();

    expect(await statusOf(outbox, row._id)).toBe("COMPLETED");
  });

  it("leaves a COMPLETED row above a lowered cap alone", async () => {
    const row = anOutboxRow("COMPLETED", ABOVE_CAP);
    await outbox.insertOne(row);

    await sweepOutbox();

    expect(await statusOf(outbox, row._id)).toBe("COMPLETED");
  });

  it.each(SWEPT_STATUSES)(
    "dead-letters a %s row at or above the cap",
    async (status) => {
      const row = anOutboxRow(status, ABOVE_CAP);
      await outbox.insertOne(row);

      await sweepOutbox();

      expect(await statusOf(outbox, row._id)).toBe("DEAD_LETTER");
    },
  );

  it("does not rewrite a row that is already DEAD_LETTER", async () => {
    await outbox.insertOne(anOutboxRow("DEAD_LETTER", ABOVE_CAP));

    const { modifiedCount } = await sweepOutbox();

    expect(modifiedCount).toBe(0);
  });
});
