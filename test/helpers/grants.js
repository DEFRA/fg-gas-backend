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
            statuses: [
              {
                code: "APPLICATION_RECEIVED",
              },
              {
                code: "IN_REVIEW",
                validFrom: [
                  {
                    code: "APPLICATION_RECEIVED",
                    processes: ["STORE_AGREEMENT_CASE"],
                  },
                  {
                    code: "APPLICATION_REJECTED",
                    processes: [],
                  },
                  {
                    code: "ON_HOLD",
                    processes: [],
                  },
                ],
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
            code: "REVIEW_APPLICATION",
            statuses: [
              { code: "APPLICATION_RECEIVED" },
              {
                code: "IN_REVIEW",
                validFrom: ["APPLICATION_RECEIVED"],
              },
              {
                code: "AGREEMENT_GENERATING",
                validFrom: ["IN_REVIEW"],
                processes: ["GENERATE_OFFER"],
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
              code: "REVIEW_APPLICATION",
              statuses: [
                {
                  code: "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING",
                  source: "CW",
                  mappedTo: "AGREEMENT_GENERATING",
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
