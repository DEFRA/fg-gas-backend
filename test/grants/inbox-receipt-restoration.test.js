import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { up as restoreReceipts } from "../../migrations/20260908130000-restore-inbox-receipt-instants.js";

// The model used to stamp `publicationDate` in its constructor, and
// `fromDocument` runs that constructor - so every claim-process cycle rewrote
// the receipt with the moment of that write. The model keeps its stored value
// now; this puts the old rows back, from the insert instant the ObjectId
// carries.

const SCOPE = "RECEIPT-RESTORE-PROBE";

let client;
let db;
let inbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db();
  inbox = db.collection("inbox");
});

afterAll(async () => {
  await inbox.deleteMany({ segregationRef: SCOPE });
  await client?.close();
});

beforeEach(async () => {
  await inbox.deleteMany({ segregationRef: SCOPE });
});

/** An id whose embedded timestamp is a known instant. */
const idAt = (iso) =>
  ObjectId.createFromTime(Math.floor(Date.parse(iso) / 1000));

const insertRow = async (insertedAt, publicationDate) => {
  const _id = idAt(insertedAt);

  await inbox.insertOne({
    _id,
    messageId: `msg-${_id.toHexString()}`,
    type: "cloud.defra.local.fg-cw-backend.case.status.updated",
    source: "CW",
    segregationRef: SCOPE,
    status: "COMPLETED",
    completionAttempts: 1,
    eventTime: insertedAt,
    publicationDate,
  });

  return _id;
};

const publicationDateOf = async (_id) =>
  (await inbox.findOne({ _id })).publicationDate;

describe("restoring inbox receipt instants", () => {
  // The pathological case: a dead letter retried for days, whose "receipt"
  // reads as its last failed attempt.
  it("puts a rewritten receipt back to the insert instant", async () => {
    const _id = await insertRow(
      "2026-06-16T10:00:00.000Z",
      "2026-06-21T18:30:00.000Z",
    );

    await restoreReceipts(db);

    expect(await publicationDateOf(_id)).toBe("2026-06-16T10:00:00.000Z");
  });

  // A receipt legitimately trails its insert by milliseconds; nothing honest
  // trails it by a minute, and nothing this cannot prove wrong is touched.
  it.each([
    ["a receipt milliseconds after the insert", "2026-06-16T10:00:00.400Z"],
    ["a receipt exactly at the insert", "2026-06-16T10:00:00.000Z"],
    ["a receipt inside the drift window", "2026-06-16T10:00:30.000Z"],
    ["a receipt BEFORE the insert", "2026-06-16T09:59:00.000Z"],
  ])("leaves %s alone", async (_name, publicationDate) => {
    const _id = await insertRow("2026-06-16T10:00:00.000Z", publicationDate);

    await restoreReceipts(db);

    expect(await publicationDateOf(_id)).toBe(publicationDate);
  });

  // Whatever an older writing path left behind, both stored forms are read.
  it("repairs a row whose receipt was stored as a Date", async () => {
    const _id = await insertRow(
      "2026-06-16T10:00:00.000Z",
      new Date("2026-06-21T18:30:00.000Z"),
    );

    await restoreReceipts(db);

    expect(await publicationDateOf(_id)).toBe("2026-06-16T10:00:00.000Z");
  });

  it.each([
    ["a receipt nothing can parse", "not-an-instant"],
    ["a receipt that is not there at all", null],
  ])("leaves %s as it found it", async (_name, publicationDate) => {
    const _id = await insertRow("2026-06-16T10:00:00.000Z", publicationDate);

    await restoreReceipts(db);

    expect(await publicationDateOf(_id)).toEqual(publicationDate);
  });

  // A repaired row's receipt IS its insert instant, so the filter cannot
  // match it a second time.
  it("matches nothing new when it is run again", async () => {
    const _id = await insertRow(
      "2026-06-16T10:00:00.000Z",
      "2026-06-21T18:30:00.000Z",
    );

    await restoreReceipts(db);
    const once = await publicationDateOf(_id);
    await restoreReceipts(db);

    expect(await publicationDateOf(_id)).toBe(once);
  });

  // Targeted, not a rewrite of the collection: rows it cannot prove wrong are
  // never written to at all.
  it("touches only the rows it can prove wrong", async () => {
    const healthy = await insertRow(
      "2026-06-16T10:00:00.000Z",
      "2026-06-16T10:00:00.400Z",
    );
    const broken = await insertRow(
      "2026-06-16T11:00:00.000Z",
      "2026-06-21T18:30:00.000Z",
    );

    const before = await inbox.findOne({ _id: healthy });
    await restoreReceipts(db);
    const after = await inbox.findOne({ _id: healthy });

    expect(after).toEqual(before);
    expect(await publicationDateOf(broken)).toBe("2026-06-16T11:00:00.000Z");
  });
});
