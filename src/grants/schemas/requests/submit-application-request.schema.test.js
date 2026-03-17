import { expect, it } from "vitest";
import { submitApplicationRequestSchema } from "./submit-application-request.schema.js";

const validPayload = {
  metadata: {
    clientRef: "ref-1234",
    sbi: "123456789",
    frn: "1234567890",
    crn: "crn-abc",
  },
  answers: {},
};

it("accepts a valid payload", () => {
  const { error } = submitApplicationRequestSchema.validate(validPayload);

  expect(error).toBeUndefined();
});

it("requires metadata", () => {
  const { error } = submitApplicationRequestSchema.validate({
    answers: {},
  });

  expect(error.message).toEqual('"metadata" is required');
});

it("requires answers", () => {
  const { error } = submitApplicationRequestSchema.validate({
    metadata: validPayload.metadata,
  });

  expect(error.message).toEqual('"answers" is required');
});

it("requires metadata.clientRef", () => {
  const { error } = submitApplicationRequestSchema.validate({
    metadata: {
      sbi: "123456789",
      frn: "1234567890",
      crn: "crn-abc",
    },
    answers: {},
  });

  expect(error.message).toEqual('"metadata.clientRef" is required');
});

it("requires metadata.sbi", () => {
  const { error } = submitApplicationRequestSchema.validate({
    metadata: {
      clientRef: "ref-1234",
      frn: "1234567890",
      crn: "crn-abc",
    },
    answers: {},
  });

  expect(error.message).toEqual('"metadata.sbi" is required');
});

it("requires metadata.frn", () => {
  const { error } = submitApplicationRequestSchema.validate({
    metadata: {
      clientRef: "ref-1234",
      sbi: "123456789",
      crn: "crn-abc",
    },
    answers: {},
  });

  expect(error.message).toEqual('"metadata.frn" is required');
});

it("requires metadata.crn", () => {
  const { error } = submitApplicationRequestSchema.validate({
    metadata: {
      clientRef: "ref-1234",
      sbi: "123456789",
      frn: "1234567890",
    },
    answers: {},
  });

  expect(error.message).toEqual('"metadata.crn" is required');
});

it("metadata.clientRef must match pattern", () => {
  const { error } = submitApplicationRequestSchema.validate({
    metadata: {
      ...validPayload.metadata,
      clientRef: "INVALID_REF",
    },
    answers: {},
  });

  expect(error.message).toContain('"metadata.clientRef"');
});

it("accepts optional metadata.previousClientRef", () => {
  const { error } = submitApplicationRequestSchema.validate({
    metadata: {
      ...validPayload.metadata,
      previousClientRef: "prev-ref-5678",
    },
    answers: {},
  });

  expect(error).toBeUndefined();
});

it("metadata.previousClientRef must match pattern when provided", () => {
  const { error } = submitApplicationRequestSchema.validate({
    metadata: {
      ...validPayload.metadata,
      previousClientRef: "INVALID REF",
    },
    answers: {},
  });

  expect(error.message).toContain('"metadata.previousClientRef"');
});

it("metadata.previousClientRef must inot be null", () => {
  const { error } = submitApplicationRequestSchema.validate({
    metadata: {
      ...validPayload.metadata,
      previousClientRef: null,
    },
    answers: {},
  });

  expect(error.message).toContain('"metadata.previousClientRef"');
});

it("accepts optional metadata.submittedAt as ISO date", () => {
  const { error } = submitApplicationRequestSchema.validate({
    metadata: {
      ...validPayload.metadata,
      submittedAt: "2024-01-15T10:30:00.000Z",
    },
    answers: {},
  });

  expect(error).toBeUndefined();
});

it("rejects invalid metadata.submittedAt", () => {
  const { error } = submitApplicationRequestSchema.validate({
    metadata: {
      ...validPayload.metadata,
      submittedAt: "not-a-date",
    },
    answers: {},
  });

  expect(error.message).toContain('"metadata.submittedAt"');
});

it("allows unknown fields in metadata", () => {
  const { error } = submitApplicationRequestSchema.validate({
    metadata: {
      ...validPayload.metadata,
      extraField: "some-value",
    },
    answers: {},
  });

  expect(error).toBeUndefined();
});

it("allows any shape in answers", () => {
  const { error } = submitApplicationRequestSchema.validate({
    metadata: validPayload.metadata,
    answers: {
      question1: "yes",
      question2: 42,
      nested: { a: true },
    },
  });

  expect(error).toBeUndefined();
});

it("strips unknown top-level fields", () => {
  const { value } = submitApplicationRequestSchema.validate({
    ...validPayload,
    unknownField: "should-be-removed",
  });

  expect(value).not.toHaveProperty("unknownField");
});
