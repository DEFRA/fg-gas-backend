import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { markPermanentFailure } from "../retryable.js";
import { Inbox, InboxStatus } from "./inbox.js";

describe("inbox model", () => {
  it("creates an inbox model", () => {
    const messageId = randomUUID();
    const obj = new Inbox({
      event: {},
      messageId,
      type: "io.onsite.agreement.status.foo",
      source: "CW",
      segregationRef: "ref-1",
    });

    expect(obj).toBeInstanceOf(Inbox);
  });

  it("should mark a document as complete", async () => {
    const messageId = randomUUID();
    const obj = new Inbox({
      event: {
        data: {
          foo: "barr",
        },
      },
      messageId,
      type: "io.onsite.agreement.status.foo",
      source: "CW",
      segregationRef: "ref-1",
    });

    obj.claimedBy = randomUUID();
    obj.claimedAt = new Date();
    obj.claimExpiresAt = new Date(Date.now() + 5000);

    obj.markAsComplete();
    expect(obj.status).toBe(InboxStatus.COMPLETED);
    expect(obj.claimedBy).toBeNull();
    expect(obj.claimedAt).toBeNull();
    expect(obj.claimExpiresAt).toBeNull();
    expect(obj.completionDate).toEqual(expect.any(String));
  });

  it("should mark a document as failed", async () => {
    const messageId = randomUUID();
    const obj = new Inbox({
      event: {
        data: {
          foo: "barr",
        },
      },
      messageId,
      type: "io.onsite.agreement.status.foo",
      source: "CW",
      segregationRef: "ref-1",
    });

    obj.claimedBy = randomUUID();
    obj.claimedAt = new Date();
    obj.claimExpiresAt = new Date(Date.now() + 5000);

    obj.markAsFailed();
    expect(obj.status).toBe(InboxStatus.FAILED);
    expect(obj.lastResubmissionDate).toEqual(expect.any(String));
    expect(obj.claimedBy).toBeNull();
    expect(obj.claimedAt).toBeNull();
    expect(obj.claimExpiresAt).toBeNull();
  });

  it("should convert to a document", () => {
    const messageId = randomUUID();
    const obj = new Inbox({
      event: {
        time: new Date().toISOString(),
        data: {
          foo: "barr",
        },
      },
      messageId,
      type: "io.onsite.agreement.status.foo",
      source: "CW",
      segregationRef: "ref-1",
    });

    obj.claimedBy = randomUUID();
    obj.claimedAt = new Date();
    obj.claimExpiresAt = new Date(Date.now() + 5000);
    const doc = obj.toDocument();
    expect(doc.event).toBe(obj.event);
    expect(doc.publicationDate).toBe(obj.publicationDate);
    expect(doc.status).toBe(obj.status);
    expect(doc.messageId).toBe(obj.messageId);
  });

  it("should throw Boom error when source is missing", () => {
    expect(
      () =>
        new Inbox({
          event: {},
          messageId: randomUUID(),
          type: "io.onsite.agreement.status.foo",
          segregationRef: "ref-1",
        }),
    ).toThrow(/"source" is required/);
  });

  it("should throw Boom error with all validation failures", () => {
    expect(() => new Inbox({})).toThrow(
      /Invalid Inbox:.*"source" is required.*"event" is required.*"segregationRef" is required/,
    );
  });

  it("should create model from doc", () => {
    const doc = {
      _id: "09909-popopo",
      claimExpiresAt: new Date("2025-10-27T13:46:58.876Z"),
      claimedAt: new Date("2025-10-27T13:46:53.876Z"),
      claimedBy: "9216e9d3-611d-41e3-bc60-a0793964e30c",
      completionAttempts: 1,
      completionDate: null,
      event: {
        data: {
          foo: "barr",
        },
      },
      lastResubmissionDate: null,
      messageId: "d2868709-7232-4f08-8375-d367901cdadf",
      publicationDate: "2025-10-27T13:46:53.876Z",
      status: "PUBLISHED",
      type: "io.onsite.agreement.status.foo",
      source: "CW",
      segregationRef: "ref-1",
    };

    const model = Inbox.fromDocument(doc);
    expect(model).toBeInstanceOf(Inbox);
    expect(model._id).toBe(doc._id);
  });

  it("keeps the publication date a document was written with", () => {
    const model = Inbox.fromDocument({
      _id: "665f1c2e9a1b2c3d4e5f6a7b",
      publicationDate: "2025-10-27T13:46:53.876Z",
      messageId: "msg-1",
      type: "io.onsite.agreement.status.foo",
      source: "CW",
      segregationRef: "ref-1",
      event: { data: {} },
      status: "PUBLISHED",
    });

    expect(model.publicationDate).toBe("2025-10-27T13:46:53.876Z");
    expect(model.toDocument().publicationDate).toBe("2025-10-27T13:46:53.876Z");
  });

  it.each([
    ["an ObjectId", new ObjectId("665f1c2e9a1b2c3d4e5f6a7b")],
    ["its hex string", "665f1c2e9a1b2c3d4e5f6a7b"],
  ])(
    "falls back to the insert time for an unreadable receipt on a row whose _id is %s",
    (_name, _id) => {
      const expected = new Date(0x665f1c2e * 1000).toISOString();

      for (const publicationDate of [undefined, null, "not-an-instant"]) {
        const model = Inbox.fromDocument({
          _id,
          publicationDate,
          messageId: "msg-1",
          type: "io.onsite.agreement.status.foo",
          source: "CW",
          segregationRef: "ref-1",
          event: { data: {} },
          status: "PUBLISHED",
        });

        expect(model.publicationDate).toBe(expected);
        expect(Inbox.fromDocument(model.toDocument()).publicationDate).toBe(
          expected,
        );
      }
    },
  );

  it("never moves a stored receipt across repeated saves", () => {
    let doc = {
      _id: new ObjectId(),
      publicationDate: "2025-10-27T13:46:53.876Z",
      messageId: "msg-1",
      type: "io.onsite.agreement.status.foo",
      source: "CW",
      segregationRef: "ref-1",
      event: { data: {} },
      status: "PUBLISHED",
    };

    for (let i = 0; i < 3; i++) {
      doc = Inbox.fromDocument(doc).toDocument();
    }

    expect(doc.publicationDate).toBe("2025-10-27T13:46:53.876Z");
  });

  it("stamps a receipt on a message that arrives without one", () => {
    const before = Date.now();

    const model = new Inbox({
      messageId: "msg-1",
      type: "io.onsite.agreement.status.foo",
      source: "CW",
      segregationRef: "ref-1",
      event: { data: {} },
    });

    expect(Date.parse(model.publicationDate)).toBeGreaterThanOrEqual(before);
  });

  // A BSON Date would sit in another type bracket from the string rows.
  const withReceipt = (publicationDate) =>
    Inbox.fromDocument({
      _id: "665f1c2e9a1b2c3d4e5f6a7b",
      publicationDate,
      messageId: "msg-1",
      type: "io.onsite.agreement.status.foo",
      source: "CW",
      segregationRef: "ref-1",
      event: { data: {} },
      status: "PUBLISHED",
    });

  it("writes a receipt read back as a Date as the same instant's ISO string", () => {
    const model = withReceipt(new Date("2025-10-27T13:46:53.876Z"));

    expect(model.toDocument().publicationDate).toBe("2025-10-27T13:46:53.876Z");
  });

  it("canonicalises an offset-bearing receipt to the Z form", () => {
    expect(withReceipt("2025-10-27T14:46:53.876+01:00").publicationDate).toBe(
      "2025-10-27T13:46:53.876Z",
    );
  });
});

describe("inbox model eventTime", () => {
  const withTime = (time) =>
    new Inbox({
      event: time === undefined ? {} : { time },
      messageId: "msg-1",
      type: "io.onsite.agreement.status.foo",
      source: "CW",
      segregationRef: "ref-1",
    });

  it("keeps a canonical time exactly as it was written", () => {
    expect(withTime("2026-06-16T10:00:00.000Z").eventTime).toBe(
      "2026-06-16T10:00:00.000Z",
    );
  });

  it.each([
    ["an offset-bearing time", "2026-06-16T11:00:00+01:00"],
    ["a time with no milliseconds", "2026-06-16T10:00:00Z"],
    ["a date with no time at all", "2026-06-16T00:00:00Z"],
  ])("canonicalises %s to the form every reader assumes", (_name, time) => {
    const stored = withTime(time).eventTime;

    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(stored)).toBe(Date.parse(time));
  });

  it.each([
    ["a message with no time", undefined],
    ["a time nothing can parse", "not-a-time"],
    ["a null time", null],
  ])("stamps %s with the moment it arrived", (_name, time) => {
    const before = Date.now();

    const stored = withTime(time).eventTime;

    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(stored)).toBeGreaterThanOrEqual(before);
  });

  it("orders lexically the way it orders chronologically", () => {
    const times = [
      "2026-06-16T11:00:00+01:00",
      "2026-06-16T10:30:00Z",
      "2026-06-16T09:00:00.500Z",
    ].map((time) => withTime(time).eventTime);

    expect([...times].sort()).toEqual(
      [...times].sort((a, b) => Date.parse(a) - Date.parse(b)),
    );
  });
});

describe("inbox model lastError", () => {
  const inbox = (props = {}) =>
    new Inbox({
      event: { time: new Date().toISOString() },
      messageId: "msg-1",
      type: "io.onsite.agreement.status.foo",
      source: "CW",
      segregationRef: "ref-1",
      ...props,
    });

  it("defaults lastError to null", () => {
    expect(inbox().lastError).toBeNull();
  });

  it("records the caught error's name and message on markAsFailed", () => {
    const obj = inbox();

    obj.markAsFailed(new TypeError("cannot read status"));

    expect(obj.lastError).toEqual({
      name: "TypeError",
      message: "cannot read status",
      at: expect.any(String),
      stack: expect.stringContaining("TypeError: cannot read status"),
    });
  });

  it("truncates a very long failure message to 1024 characters", () => {
    const obj = inbox();

    obj.markAsFailed(new Error("y".repeat(4000)));

    expect(obj.lastError.message).toHaveLength(1024);
  });

  it("keeps the previous lastError when markAsFailed is called with no error", () => {
    const obj = inbox({
      lastError: {
        name: "Error",
        message: "earlier",
        at: "2026-06-16T10:00:00.000Z",
      },
    });

    obj.markAsFailed();

    expect(obj.lastError.message).toEqual("earlier");
  });

  it("carries lastError through toDocument and fromDocument", () => {
    const lastError = {
      name: "ClaimExpired",
      message: "claim expired before completion",
      at: "2026-06-16T10:00:00.000Z",
    };

    const document = inbox({ lastError }).toDocument();

    expect(document.lastError).toEqual(lastError);
    expect(Inbox.fromDocument(document).lastError).toEqual(lastError);
  });

  it("reads a legacy document with no lastError as null", () => {
    const document = inbox().toDocument();
    delete document.lastError;

    expect(Inbox.fromDocument(document).lastError).toBeNull();
  });
});

describe("Inbox attemptHistory", () => {
  const failed = (times, error = new Error("boom")) => {
    const event = Inbox.createMock();

    for (let i = 0; i < times; i++) {
      event.markAsFailed(error);
    }

    return event;
  };

  it("starts empty on a new event", () => {
    expect(Inbox.createMock().attemptHistory).toEqual([]);
  });

  it("reads a row written before attempt history existed as empty", () => {
    const event = Inbox.fromDocument({
      ...Inbox.createMock().toDocument(),
      attemptHistory: undefined,
    });

    expect(event.attemptHistory).toEqual([]);
  });

  it("appends one entry per failure, oldest first", () => {
    const event = failed(1);

    expect(event.attemptHistory).toEqual([
      {
        at: expect.any(String),
        name: "Error",
        message: "boom",
        stack: expect.stringContaining("Error: boom"),
      },
    ]);
  });

  it("keeps only the ten most recent entries", () => {
    const event = Inbox.createMock();

    for (let i = 0; i < 14; i++) {
      event.markAsFailed(new Error(`attempt-${i}`));
    }

    expect(event.attemptHistory).toHaveLength(10);
    expect(event.attemptHistory.at(0).message).toBe("attempt-4");
    expect(event.attemptHistory.at(-1).message).toBe("attempt-13");
  });

  it("truncates an entry's message to 512 characters", () => {
    const event = failed(1, new Error("x".repeat(2000)));

    expect(event.attemptHistory.at(-1).message).toHaveLength(512);
  });

  it("records the same reason as lastError", () => {
    const event = failed(1, new TypeError("kaput"));

    expect(event.attemptHistory.at(-1)).toMatchObject({
      name: "TypeError",
      message: "kaput",
    });
    expect(event.lastError).toMatchObject({
      name: "TypeError",
      message: "kaput",
    });
  });

  it("appends nothing when markAsFailed is called with no error", () => {
    const event = failed(2);

    event.markAsFailed();

    expect(event.attemptHistory).toHaveLength(2);
  });

  it("leaves the history intact on markAsComplete", () => {
    const event = failed(2);

    event.markAsComplete();

    expect(event.status).toBe(InboxStatus.COMPLETED);
    expect(event.attemptHistory).toHaveLength(2);
  });

  it("carries the history onto the document it writes", () => {
    const event = failed(1);

    expect(event.toDocument().attemptHistory).toEqual(event.attemptHistory);
  });

  it("reads a stored history back off a document", () => {
    const stored = [{ at: null, name: "ClaimExpired", message: "gone" }];
    const event = Inbox.fromDocument({
      ...Inbox.createMock().toDocument(),
      attemptHistory: stored,
    });

    expect(event.attemptHistory).toEqual(stored);
  });
});

describe("retryable", () => {
  it("is retryable by default", () => {
    expect(Inbox.createMock().retryable).toBe(true);
  });

  it("stays retryable when a failure says nothing", () => {
    const inbox = Inbox.createMock();

    inbox.markAsFailed(new Error("mongo is down"));

    expect(inbox.retryable).toBe(true);
  });

  // A definition that will not build is just as unusable next time round.
  it("stops being retryable when the failure cannot be fixed by retrying", () => {
    const inbox = Inbox.createMock();

    inbox.markAsFailed(markPermanentFailure(new Error("bad definition")));

    expect(inbox.retryable).toBe(false);
  });

  it("stays FAILED when the failure could be fixed by retrying", () => {
    const inbox = Inbox.createMock();

    inbox.markAsFailed(new Error("mongo is down"));

    expect(inbox.status).toBe(InboxStatus.FAILED);
  });

  // FAILED cannot be redriven and is not in the dead-letter breakdown, so a failure we
  // have given up on has to land somewhere an operator can actually see and act on it.
  it("goes straight to the dead letter queue when retrying cannot fix it", () => {
    const inbox = Inbox.createMock();

    inbox.markAsFailed(markPermanentFailure(new Error("bad definition")));

    expect(inbox.status).toBe(InboxStatus.DEAD_LETTER);
  });

  it("keeps the reason it was given up on", () => {
    const inbox = Inbox.createMock();

    inbox.markAsFailed(markPermanentFailure(new Error("bad definition")));

    expect(inbox.lastError.message).toBe("bad definition");
  });

  it("round-trips through a document", () => {
    const inbox = Inbox.createMock();
    inbox.markAsFailed(markPermanentFailure(new Error("bad definition")));

    const restored = Inbox.fromDocument(inbox.toDocument());

    expect(restored.retryable).toBe(false);
  });

  // Rows written before the field existed must keep the behaviour they had.
  it("reads a document with no retryable field as retryable", () => {
    const { retryable, ...document } = Inbox.createMock().toDocument();

    expect(Inbox.fromDocument(document).retryable).toBe(true);
  });
});

describe("inbox model expireAt", () => {
  const NOW = new Date("2026-09-17T16:18:00.000Z");
  const NINETY_DAYS_ON = new Date("2026-12-16T16:18:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is null on a new row - nothing in flight is ever deleted", () => {
    expect(Inbox.createMock().expireAt).toBeNull();
  });

  it("is set to the retention period after completion", () => {
    const event = Inbox.createMock();

    event.markAsComplete();

    expect(config.events.retentionDays).toBe(90);
    expect(event.expireAt).toEqual(NINETY_DAYS_ON);
    expect(event.expireAt).toBeInstanceOf(Date);
  });

  it("is exactly the retention period after the completion it records", () => {
    const event = Inbox.createMock();

    event.markAsComplete();

    expect(event.expireAt.getTime() - Date.parse(event.completionDate)).toBe(
      config.events.retentionDays * 86_400_000,
    );
  });

  it("is nulled by a retryable failure, which leaves the row FAILED", () => {
    const event = Inbox.createMock();
    event.markAsComplete();

    event.markAsFailed(new Error("boom"));

    expect(event.status).toBe(InboxStatus.FAILED);
    expect(event.expireAt).toBeNull();
  });

  it("is nulled by a permanent failure, which dead-letters the row", () => {
    const event = Inbox.createMock();
    event.markAsComplete();

    event.markAsFailed(markPermanentFailure(new Error("bad definition")));

    expect(event.status).toBe(InboxStatus.DEAD_LETTER);
    expect(event.expireAt).toBeNull();
  });

  it("round-trips through toDocument and fromDocument", () => {
    const event = Inbox.createMock();
    event.markAsComplete();

    const document = event.toDocument();

    expect(document.expireAt).toEqual(NINETY_DAYS_ON);
    expect(Inbox.fromDocument(document).expireAt).toEqual(NINETY_DAYS_ON);
    expect(Inbox.fromDocument(document).toDocument().expireAt).toEqual(
      NINETY_DAYS_ON,
    );
  });

  it("reads a row written before the field existed as null", () => {
    const document = Inbox.createMock().toDocument();
    delete document.expireAt;

    expect(Inbox.fromDocument(document).expireAt).toBeNull();
    expect(Inbox.fromDocument(document).toDocument().expireAt).toBeNull();
  });
});

describe("Inbox.eventColumns", () => {
  it("derives the columns exactly as the constructor does", () => {
    const event = { type: "a.b.c", time: "2026-09-20T08:00:00+01:00" };
    const inbox = Inbox.createMock({ type: "a.b.c", event });

    expect(Inbox.eventColumns(event)).toEqual({
      type: inbox.type,
      eventTime: inbox.eventTime,
    });
    expect(Inbox.eventColumns(event).eventTime).toBe(
      "2026-09-20T07:00:00.000Z",
    );
  });

  it("stores a null type for an event without one", () => {
    expect(
      Inbox.eventColumns({ time: "2026-09-20T07:00:00.000Z" }).type,
    ).toBeNull();
  });
});
