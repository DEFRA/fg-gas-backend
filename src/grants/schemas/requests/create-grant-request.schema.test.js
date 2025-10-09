import { expect, it } from "vitest";
import { createGrantRequestSchema } from "./create-grant-request.schema.js";

const validPhases = [
  {
    code: "PRE_AWARD",
    stages: [
      {
        code: "ASSESSMENT",
        statuses: [{ code: "RECEIVED" }],
      },
    ],
    questions: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
    },
  },
];

it("requires a code", () => {
  const { error } = createGrantRequestSchema.validate({
    phases: validPhases,
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    actions: [],
  });

  expect(error.message).toEqual('"code" is required');
});

it("requires a metadata property", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    phases: validPhases,
    actions: [],
  });

  expect(error.message).toEqual('"Metadata" is required');
});

it("requires a phases property", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    actions: [],
  });

  expect(error.message).toEqual('"Phases" is required');
});

it("requires a metadata.description property", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      startDate: "2100-01-01T00:00:00.000Z",
    },
    phases: validPhases,
    actions: [],
  });

  expect(error.message).toEqual('"metadata.description" is required');
});

it("requires a metadata.startDate property", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
    },
    phases: validPhases,
    actions: [],
  });

  expect(error.message).toEqual('"metadata.startDate" is required');
});

it("requires actions property", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    phases: validPhases,
  });

  expect(error.message).toEqual('"Actions" is required');
});

it("requires actions to be unique by name", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    phases: validPhases,
    actions: [
      {
        name: "action1",
        method: "GET",
        url: "http://example.com",
      },
      {
        name: "action1",
        method: "POST",
        url: "http://example.com",
      },
    ],
  });

  expect(error.message).toEqual('"Actions" contains a duplicate value');
});
