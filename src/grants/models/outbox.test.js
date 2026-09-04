import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Outbox, OutboxStatus } from "./outbox.js";

describe("Outbox.validationSchema", () => {
  const validProps = {
    target: "arn:some:target",
    event: { clientRef: "1234" },
    segregationRef: "seg-ref-1",
  };

  it("should accept valid props", () => {
    const { error } = Outbox.validationSchema.validate(validProps);
    expect(error).toBeUndefined();
  });

  it("should require target", () => {
    const { target, ...props } = validProps;
    const { error } = Outbox.validationSchema.validate(props);
    expect(error.message).toContain('"target" is required');
  });

  it("should require target to be a string", () => {
    const { error } = Outbox.validationSchema.validate({
      ...validProps,
      target: 123,
    });
    expect(error.message).toContain('"target" must be a string');
  });

  it("should require event", () => {
    const { event, ...props } = validProps;
    const { error } = Outbox.validationSchema.validate(props);
    expect(error.message).toContain('"event" is required');
  });

  it("should require event to be an object", () => {
    const { error } = Outbox.validationSchema.validate({
      ...validProps,
      event: "not-an-object",
    });
    expect(error.message).toContain('"event" must be of type object');
  });

  it("should require segregationRef", () => {
    const { segregationRef, ...props } = validProps;
    const { error } = Outbox.validationSchema.validate(props);
    expect(error.message).toContain('"segregationRef" is required');
  });

  it("should require segregationRef to be a string", () => {
    const { error } = Outbox.validationSchema.validate({
      ...validProps,
      segregationRef: 42,
    });
    expect(error.message).toContain('"segregationRef" must be a string');
  });

  it("should strip unknown properties", () => {
    const { value } = Outbox.validationSchema.validate(
      { ...validProps, unknown: "field" },
      { stripUnknown: true },
    );
    expect(value).not.toHaveProperty("unknown");
  });

  it("should report all errors when abortEarly is false", () => {
    const { error } = Outbox.validationSchema.validate(
      {},
      { abortEarly: false },
    );
    expect(error.details).toHaveLength(3);
  });
});

describe("Outbox model", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should create an outbox object", () => {
    const date = new Date(2025, 1, 1, 13);
    vi.setSystemTime(date);
    const obj = new Outbox({
      event: {
        clientRef: "1234",
      },
      target: "arn:some:target",
      segregationRef: "seg-ref-1",
    });
    expect(obj).toBeInstanceOf(Outbox);
    expect(obj.target).toBe("arn:some:target");
    expect(obj.event.clientRef).toBe("1234");
    expect(obj.status).toBe(OutboxStatus.PUBLISHED);
    // zero attempts MADE, not one granted - see ATTEMPT ARITHMETIC in the model
    expect(obj.completionAttempts).toBe(0);
    expect(obj.publicationDate).toEqual(date);
  });

  it("should create an outbox object from existing document", () => {
    const doc = {
      _id: "68f0cbf0680515dd0e0359d2",
      publicationDate: "2025-10-16T10:41:52.964Z",
      target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_agreement",
      event: {
        id: "54016d5e-d489-4fa4-9079-9725bdf6d41a",
        source: "fg-gas-backend",
        specversion: "1.0",
        datacontenttype: "application/json",
        time: "2025-10-16T10:41:52.964Z",
        traceparent: "mock-traceparent",
        type: "cloud.defra.local.fg-gas-backend.agreement.create",
        data: {
          clientRef: "julian-test-003",
          code: "pigs-might-fly",
          identifiers: {
            sbi: "123456789",
            frn: "987654321",
            crn: "CRN123456",
            defraId: "DEFRA123456",
          },
          answers: {},
        },
      },
      lastResubmissionDate: null,
      completionAttempts: 1,
      status: "COMPLETED",
      completionDate: "2025-10-16T10:42:02.720Z",
      claimedAt: null,
      claimedBy: null,
      claimExpiresAt: null,
      segregationRef: "seg-ref-1",
    };
    const out = Outbox.fromDocument(doc);
    expect(out).toBeInstanceOf(Outbox);

    const newDoc = out.toDocument();
    expect(newDoc._id).toBe("68f0cbf0680515dd0e0359d2");
    // Normalised to a Date on the way through the model: a legacy string must
    // never be written back as a string. See the mixed-type keyset fault in
    // migrations/20260901130000-normalise-event-sort-keys.js.
    expect(newDoc.publicationDate).toBeInstanceOf(Date);
    expect(newDoc.publicationDate).toEqual(
      new Date("2025-10-16T10:41:52.964Z"),
    );
    expect(newDoc.target).toBe(
      "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_agreement",
    );
    expect(newDoc.event).toBe(out.event);
  });

  it("converts a string publicationDate to a Date", () => {
    const obj = new Outbox({
      publicationDate: "2025-10-16T10:41:52.964Z",
      event: { clientRef: "1234" },
      target: "arn:some:target",
      segregationRef: "seg-ref-1",
    });

    expect(obj.publicationDate).toBeInstanceOf(Date);
    expect(obj.publicationDate).toEqual(new Date("2025-10-16T10:41:52.964Z"));
    expect(obj.toDocument().publicationDate).toBeInstanceOf(Date);
  });

  it("leaves a Date publicationDate as an equivalent Date", () => {
    const date = new Date("2025-10-16T10:41:52.964Z");
    const obj = new Outbox({
      publicationDate: date,
      event: { clientRef: "1234" },
      target: "arn:some:target",
      segregationRef: "seg-ref-1",
    });

    expect(obj.publicationDate).toBeInstanceOf(Date);
    expect(obj.publicationDate).toEqual(date);
  });

  it("should throw Boom error when required fields are missing", () => {
    expect(() => new Outbox({})).toThrow(
      /Invalid Outbox:.*"target" is required.*"event" is required.*"segregationRef" is required/,
    );
  });

  it("should throw Boom error when target is missing", () => {
    expect(
      () =>
        new Outbox({
          event: { clientRef: "1234" },
          segregationRef: "seg-ref-1",
        }),
    ).toThrow(/"target" is required/);
  });

  it("should return segregationRef from event data via getSegregationRef", () => {
    const event = { data: { clientRef: "CR001", grantCode: "GC001" } };
    const ref = Outbox.getSegregationRef(event);
    expect(ref).toBe("CR001-GC001");
  });

  it("should mark outbox as failed", () => {
    const obj = new Outbox({
      event: {
        clientRef: "1234",
      },
      target: "arn:some:target",
      segregationRef: "seg-ref-1",
    });
    expect(obj).toBeInstanceOf(Outbox);
    obj.markAsFailed();
    expect(obj.status).toBe(OutboxStatus.FAILED);
  });

  it("should mark outbox as complete", () => {
    const obj = new Outbox({
      event: {
        clientRef: "1234",
      },
      target: "arn:some:target",
      segregationRef: "seg-ref-1",
    });
    expect(obj).toBeInstanceOf(Outbox);
    obj.markAsComplete();
    expect(obj.status).toBe(OutboxStatus.COMPLETED);
  });
});

describe("outbox model lastError", () => {
  const outbox = (props = {}) =>
    new Outbox({
      target: "arn:aws:sns:eu-west-2:000000000000:mock-topic",
      event: { id: "evt-1" },
      segregationRef: "ref-1",
      ...props,
    });

  it("defaults lastError to null", () => {
    expect(outbox().lastError).toBeNull();
  });

  it("records the caught error's name and message on markAsFailed", () => {
    const obj = outbox();

    obj.markAsFailed(new Error("Topic does not exist"));

    expect(obj.lastError).toEqual({
      name: "Error",
      message: "Topic does not exist",
      at: expect.any(String),
    });
  });

  it("truncates a very long failure message to 1024 characters", () => {
    const obj = outbox();

    obj.markAsFailed(new Error("y".repeat(4000)));

    expect(obj.lastError.message).toHaveLength(1024);
  });

  it("keeps the previous lastError when markAsFailed is called with no error", () => {
    const obj = outbox({
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

    const document = outbox({ lastError }).toDocument();

    expect(document.lastError).toEqual(lastError);
    expect(Outbox.fromDocument(document).lastError).toEqual(lastError);
  });

  it("reads a legacy document with no lastError as null", () => {
    const document = outbox().toDocument();
    delete document.lastError;

    expect(Outbox.fromDocument(document).lastError).toBeNull();
  });
});

describe("Outbox attemptHistory", () => {
  const failed = (times, error = new Error("boom")) => {
    const event = Outbox.createMock();

    for (let i = 0; i < times; i++) {
      event.markAsFailed(error);
    }

    return event;
  };

  it("starts empty on a new event", () => {
    expect(Outbox.createMock().attemptHistory).toEqual([]);
  });

  it("reads a row written before attempt history existed as empty", () => {
    const event = Outbox.fromDocument({
      ...Outbox.createMock().toDocument(),
      attemptHistory: undefined,
    });

    expect(event.attemptHistory).toEqual([]);
  });

  it("appends one entry per failure, oldest first", () => {
    const event = failed(1);

    expect(event.attemptHistory).toEqual([
      { at: expect.any(String), name: "Error", message: "boom" },
    ]);
  });

  it("keeps only the ten most recent entries", () => {
    const event = Outbox.createMock();

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

    expect(event.status).toBe(OutboxStatus.COMPLETED);
    expect(event.attemptHistory).toHaveLength(2);
  });

  it("carries the history onto the document it writes", () => {
    const event = failed(1);

    expect(event.toDocument().attemptHistory).toEqual(event.attemptHistory);
  });

  it("reads a stored history back off a document", () => {
    const stored = [{ at: null, name: "ClaimExpired", message: "gone" }];
    const event = Outbox.fromDocument({
      ...Outbox.createMock().toDocument(),
      attemptHistory: stored,
    });

    expect(event.attemptHistory).toEqual(stored);
  });
});
