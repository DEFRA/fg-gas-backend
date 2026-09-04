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

const validEntitlementTemplate = {
  claimCode: "ENT_CS_CAPITAL_PA3",
  name: "PA3 entitlement",
  description: "The maximum eligible area that can be claimed.",
  materialised: false,
  fields: {
    totalHectares: {
      input: true,
      label: "Total area of eligible woodland",
      unitType: "decimal",
      decimalPlaces: 4,
      unit: "HA",
      minValue: 0.5,
      maxValue: null,
    },
    actionCode: {
      input: false,
      value: "PA3",
      unitType: "string",
      minLength: 1,
      maxLength: null,
    },
  },
  maxEntitlements: 1,
  availableAt: [
    {
      phase: "PRE_AWARD",
      stage: "ASSESSMENT",
      status: "APPLICATION_RECEIVED",
    },
  ],
  claim: {
    limits: { maximumClaims: 1, allowsPartialClaims: false },
    requiresApproval: false,
    requiresEvidence: false,
  },
};

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

it("accepts entitlementTemplates as optional", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    phases: validPhases,
    actions: [],
    amendablePositions: [],
    entitlementTemplates: [validEntitlementTemplate],
  });

  expect(error).toBeUndefined();
});

// A client may spell "no entitlements" either way. Omitting the key is what
// every grant created before this block existed does; sending [] is what a
// client round-tripping a normalised response back to us does.
it.each([
  ["omitted", {}],
  ["an explicit empty array", { entitlementTemplates: [] }],
])("accepts a grant whose entitlementTemplates are %s", (_label, templates) => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    phases: validPhases,
    actions: [],
    amendablePositions: [],
    ...templates,
  });

  expect(error).toBeUndefined();
});

it("rejects entitlementTemplates sent as null", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    phases: validPhases,
    actions: [],
    amendablePositions: [],
    entitlementTemplates: null,
  });

  expect(error.message).toContain('"EntitlementTemplates" must be an array');
});

it("rejects entitlementTemplates with duplicate claim codes", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    phases: validPhases,
    actions: [],
    amendablePositions: [],
    entitlementTemplates: [validEntitlementTemplate, validEntitlementTemplate],
  });

  expect(error.message).toContain("contains a duplicate value");
});

it("accepts a claimable entitlement template with multiple instances", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    phases: validPhases,
    actions: [],
    amendablePositions: [],
    entitlementTemplates: [
      {
        ...validEntitlementTemplate,
        maxEntitlements: 2,
        claim: {
          ...validEntitlementTemplate.claim,
          claimableAt: [
            {
              phase: "PRE_AWARD",
              stage: "ASSESSMENT",
              status: "APPLICATION_RECEIVED",
            },
          ],
        },
      },
    ],
  });

  expect(error).toBeUndefined();
});

it("accepts a materialised entitlement template that carries nothing but its position", () => {
  const { error, value } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    phases: validPhases,
    actions: [],
    amendablePositions: [],
    entitlementTemplates: [
      {
        claimCode: "ENT_TRACTOR",
        name: "Tractor entitlement",
        availableAt: [
          {
            phase: "PRE_AWARD",
            stage: "ASSESSMENT",
            status: "APPLICATION_RECEIVED",
          },
        ],
      },
    ],
  });

  expect(error).toBeUndefined();
  expect(value.entitlementTemplates[0].materialised).toBe(true);
});

it("rejects a persisted entitlement template that collects no input", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    phases: validPhases,
    actions: [],
    amendablePositions: [],
    entitlementTemplates: [
      {
        ...validEntitlementTemplate,
        fields: { actionCode: validEntitlementTemplate.fields.actionCode },
      },
    ],
  });

  expect(error.message).toContain(
    '"fields" must define at least one field with "input" true when "materialised" is false',
  );
});

it("rejects an entitlement template field with a constraint from the wrong unit type", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    phases: validPhases,
    actions: [],
    amendablePositions: [],
    entitlementTemplates: [
      {
        ...validEntitlementTemplate,
        fields: {
          ...validEntitlementTemplate.fields,
          actionCode: {
            ...validEntitlementTemplate.fields.actionCode,
            decimalPlaces: 2,
          },
        },
      },
    ],
  });

  expect(error.message).toContain(
    '"entitlementTemplates[0].fields.actionCode.decimalPlaces" is not allowed',
  );
});

it("validates entitlementTemplates structure - requires claimCode", () => {
  const { error } = createGrantRequestSchema.validate({
    code: "test",
    metadata: {
      description: "test",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    phases: validPhases,
    actions: [],
    amendablePositions: [],
    entitlementTemplates: [{}],
  });

  expect(error.message).toContain(
    '"entitlementTemplates[0].claimCode" is required',
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
