import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PURGE_NOTE_MAX,
  PURGE_REASON_CODES,
  PURGE_REASON_REQUIRING_NOTE,
  purgeConflict,
  purgeUpdate,
} from "./event-purge.js";
import { appendAction } from "./event-history.js";

const ID = "665f1c2e9a1b2c3d4e5f6a7b";
const NOW = new Date("2026-09-21T09:00:00.000Z");
const RETENTION_DAYS = 90;
// now + 90 days.
const DELETION_DATE = new Date("2026-12-20T09:00:00.000Z");

const anUpdate = (overrides = {}) =>
  purgeUpdate("PURGED", {
    by: "donatas",
    reasonCode: "BROKEN_PAYLOAD",
    note: "the payload lost its clientRef",
    retentionDays: RETENTION_DAYS,
    ...overrides,
  });

const setOf = (overrides) => {
  const [{ $set }] = anUpdate(overrides);

  return {
    ...$set,
    lastPurge: $set.lastPurge.$literal,
    expireAt: $set.expireAt.$literal,
  };
};

describe("PURGE_REASON_CODES", () => {
  it("is the fixed vocabulary the admin offers, in the order it offers it", () => {
    expect(PURGE_REASON_CODES).toEqual([
      "BROKEN_PAYLOAD",
      "SENT_IN_ERROR",
      "OTHER",
    ]);
  });

  it("names the one code that cannot stand without a note", () => {
    expect(PURGE_REASON_REQUIRING_NOTE).toBe("OTHER");
    expect(PURGE_REASON_CODES).toContain(PURGE_REASON_REQUIRING_NOTE);
  });

  it("caps the note short of anything a payload would fit in", () => {
    expect(PURGE_NOTE_MAX).toBe(500);
  });
});

describe("purgeUpdate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets the status, the record and the deadline, and nothing else", () => {
    expect(Object.keys(setOf())).toEqual([
      "status",
      "lastPurge",
      "expireAt",
      "payloadRevision",
      "history",
    ]);
  });

  it("moves the payload revision on, so an editor opened before it is stale", () => {
    expect(setOf().payloadRevision).toEqual({
      $add: [{ $ifNull: ["$payloadRevision", 0] }, 1],
    });
  });

  it("appends the purge to the history, as the record it stores", () => {
    expect(setOf().history).toEqual(
      appendAction({ kind: "purged", ...setOf().lastPurge }),
    );
  });

  it("moves the row to the status it was given", () => {
    expect(setOf().status).toBe("PURGED");
  });

  it("records who purged it, why, and what they said about it", () => {
    expect(setOf().lastPurge).toEqual({
      at: "2026-09-21T09:00:00.000Z",
      by: "donatas",
      reasonCode: "BROKEN_PAYLOAD",
      note: "the payload lost its clientRef",
    });
  });

  // Storage keeps a null actor; only the display layer names it `System`.
  it("stores a null actor where nobody named themselves", () => {
    expect(setOf({ by: undefined }).lastPurge.by).toBeNull();
    expect(JSON.stringify(anUpdate({ by: null }))).not.toContain("System");
  });

  it("stores a null note where none was given", () => {
    expect(setOf({ note: undefined }).lastPurge.note).toBeNull();
    expect(setOf({ note: null }).lastPurge.note).toBeNull();
  });

  it("records the moment as an ISO string", () => {
    expect(typeof setOf().lastPurge.at).toBe("string");
  });

  // The TTL index compares BSON Dates; a string is simply never deleted.
  it("sets the deadline as a BSON Date, retention days out", () => {
    expect(setOf().expireAt).toBeInstanceOf(Date);
    expect(setOf().expireAt).toEqual(DELETION_DATE);
  });

  it("counts the deadline from a shorter retention when one is configured", () => {
    expect(setOf({ retentionDays: 30 }).expireAt).toEqual(
      new Date("2026-10-21T09:00:00.000Z"),
    );
  });

  it("counts the deadline from the moment it recorded", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    const { lastPurge, expireAt } = setOf({ at });

    expect(lastPurge.at).toBe("2026-01-01T00:00:00.000Z");
    expect(expireAt).toEqual(new Date("2026-04-01T00:00:00.000Z"));
  });

  it("takes the clock when it is given no moment", () => {
    expect(setOf().lastPurge.at).toBe(NOW.toISOString());
  });

  // A purge is not a redaction: what a redrive needs has to survive it.
  it("touches neither the payload, the attempt history nor the last error", () => {
    const update = JSON.stringify(anUpdate());

    expect(update).not.toContain("event");
    expect(update).not.toContain("attemptHistory");
    expect(update).not.toContain("lastError");
    expect(update).not.toContain("completionAttempts");
  });
});

describe("purgeConflict", () => {
  it("is a 409", () => {
    expect(purgeConflict("gas inbox", ID, "COMPLETED").output.statusCode).toBe(
      409,
    );
  });

  it("puts the current status in the body", () => {
    expect(
      purgeConflict("gas inbox", ID, "COMPLETED").output.payload.status,
    ).toBe("COMPLETED");
  });

  it("puts the words that status is spelled in beside it", () => {
    expect(
      purgeConflict("gas inbox", ID, "PURGED", "Purged").output.payload
        .statusLabel,
    ).toBe("Purged");
  });

  // Unlike a redrive, which takes a purged row too.
  it("names the box, the id and the one status a purge takes", () => {
    const { message } = purgeConflict("gas outbox", ID, "PUBLISHED").output
      .payload;

    expect(message).toBe(
      `gas outbox event "${ID}" is PUBLISHED, not DEAD_LETTER`,
    );
  });
});
