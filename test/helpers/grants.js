import { Grant } from "../../src/grants/models/grant.js";
import { wreck } from "./wreck.js";

export const createTestGrant = (overrides = {}) => {
  return new Grant({
    code: "test-grant",
    metadata: {
      description: "Test Grant",
      startDate: "2023-01-01T00:00:00Z",
    },
    actions: [],
    phases: [
      {
        code: "PRE_AWARD",
        stages: [
          {
            code: "ASSESSMENT",
            statuses: [{ code: "RECEIVED" }, { code: "REVIEW" }],
          },
        ],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            question1: {
              type: "string",
            },
          },
        },
      },
    ],
    ...overrides,
  });
};

export const createGrant = async () => {
  const payload = {
    code: "test-code-1",
    metadata: {
      description: "test description 1",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    actions: [],
    phases: [
      {
        code: "PRE_AWARD",
        stages: [
          {
            code: "ASSESSMENT",
            statuses: [
              { code: "RECEIVED" },
              {
                code: "APPROVED",
                validFrom: ["RECEIVED"],
                entryProcesses: ["GENERATE_AGREEMENT"],
              },
            ],
          },
        ],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            question1: {
              type: "string",
              description: "This is a test question",
            },
          },
        },
      },
    ],
    externalStatusMap: {
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "ASSESSMENT",
              statuses: [
                {
                  code: "APPROVED",
                  source: "CW",
                  mappedTo: "::APPROVED",
                },
              ],
            },
          ],
        },
      ],
    },
  };

  await wreck.post("/grants", {
    json: true,
    payload,
  });
};
