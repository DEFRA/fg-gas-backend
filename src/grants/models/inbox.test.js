import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
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

  // Every claim-process cycle reads a row into a model and writes it back,
  // so a `publicationDate` stamped in the constructor would be overwritten
  // with the moment of that write - see the model.
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

  // A message this service has just taken off the queue has no receipt yet,
  // and this is where it gets one.
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
});

// Everything downstream reads `eventTime` as a Z-normalised, ms-precision ISO
// string: the keyset compares it as text, the range bounds are string bounds,
// and the four-source merge orders by `Date.parse` of it. A CloudEvent `time`
// is none of those by contract, and stored verbatim each spelling breaks a
// different reader - which is how a row gets skipped across a page boundary
// rather than merely misplaced.
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

  // A sort key that is absent sorts nowhere: it re-creates the mixed-type
  // bracket the migration exists to remove.
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

  // The property the whole merge rests on: text order is time order.
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
      // Stored for diagnosis; the outbound mappers never serve it.
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
        // The frames the attempts section expands to reveal.
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
