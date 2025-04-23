import { it, expect } from "vitest";
import { createGrantRequest } from "./create-grant-request.js";

it("requires a code", () => {
  const { error } = createGrantRequest.validate({
    questions: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
    },
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    actions: [],
  });

  expect(error.message).toEqual('"code" is required');
});

it("requires a metadata property", () => {
  const { error } = createGrantRequest.validate({
    code: "test",
    questions: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
    },
    actions: [],
  });

  expect(error.message).toEqual('"Metadata" is required');
});

it("requires a questions property", () => {
  const { error } = createGrantRequest.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    actions: [],
  });

  expect(error.message).toEqual('"Questions" is required');
});

it("requires a metadata.description property", () => {
  const { error } = createGrantRequest.validate({
    code: "test",
    metadata: {
      startDate: "2100-01-01T00:00:00.000Z",
    },
    questions: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
    },
    actions: [],
  });

  expect(error.message).toEqual('"metadata.description" is required');
});

it("requires a metadata.startDate property", () => {
  const { error } = createGrantRequest.validate({
    code: "test",
    metadata: {
      description: "test",
    },
    questions: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
    },
    actions: [],
  });

  expect(error.message).toEqual('"metadata.startDate" is required');
});

it("requires actions property", () => {
  const { error } = createGrantRequest.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    questions: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
    },
  });

  expect(error.message).toEqual('"Actions" is required');
});

it("requires actions to be unique by name", () => {
  const { error } = createGrantRequest.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    questions: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
    },
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
