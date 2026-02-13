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
    expect(obj.completionAttempts).toBe(1);
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
    expect(newDoc.publicationDate).toBe("2025-10-16T10:41:52.964Z");
    expect(newDoc.target).toBe(
      "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_agreement",
    );
    expect(newDoc.event).toBe(out.event);
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
