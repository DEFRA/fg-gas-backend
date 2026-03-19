import { expect, it } from "vitest";
import { createGrantRequestSchema } from "./create-grant-request.schema.js";

const validPhases = [
  {
    code: "PRE_AWARD",
    stages: [
      {
        code: "ASSESSMENT",
        statuses: [
          {
            code: "APPLICATION_RECEIVED",
            validFrom: [],
          },
        ],
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
    amendablePositions: [],
  });

  expect(error.message).toEqual('"code" is required');
});

it("requires a metadata property", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    phases: validPhases,
    actions: [],
    amendablePositions: [],
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
    amendablePositions: [],
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
    amendablePositions: [],
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
    amendablePositions: [],
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
    amendablePositions: [],
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
    amendablePositions: [],
  });

  expect(error.message).toEqual('"Actions" contains a duplicate value');
});

it("accepts externalStatusMap as optional", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    phases: validPhases,
    actions: [],
    amendablePositions: [],
    externalStatusMap: {
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "REVIEW",
              statuses: [
                {
                  code: "IN_PROGRESS",
                  source: "CW",
                  mappedTo: "IN_PROGRESS",
                },
              ],
            },
          ],
        },
      ],
    },
  });

  expect(error).toBeUndefined();
});

it("validates externalStatusMap structure - requires phases", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    phases: validPhases,
    actions: [],
    amendablePositions: [],
    externalStatusMap: {},
  });

  expect(error.message).toEqual('"externalStatusMap.phases" is required');
});

it("validates externalStatusMap structure - requires at least one phase", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    phases: validPhases,
    actions: [],
    amendablePositions: [],
    externalStatusMap: {
      phases: [],
    },
  });

  expect(error.message).toEqual(
    '"externalStatusMap.phases" must contain at least 1 items',
  );
});

it("validates externalStatusMap structure - requires status code, source, and mappedTo", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    phases: validPhases,
    actions: [],
    amendablePositions: [],
    externalStatusMap: {
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "REVIEW",
              statuses: [
                {
                  code: "IN_PROGRESS",
                  source: "CW",
                  // missing mappedTo
                },
              ],
            },
          ],
        },
      ],
    },
  });

  expect(error.message).toEqual(
    '"externalStatusMap.phases[0].stages[0].statuses[0].mappedTo" is required',
  );
});
