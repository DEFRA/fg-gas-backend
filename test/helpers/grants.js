import { MongoClient } from "mongodb";
import { env } from "node:process";
import { GrantDocument } from "../../src/grants/models/grant-document.js";
import { Grant } from "../../src/grants/models/grant.js";
import { seedConfigVersion } from "./applications.js";

export const insertGrant = async (payload) => {
  const client = await MongoClient.connect(env.MONGO_URI);
  try {
    await client
      .db()
      .collection("grants")
      .insertOne(new GrantDocument(new Grant(payload)));
  } finally {
    await client.close();
  }
};

export const createTestGrant = (overrides = {}) => {
  return new Grant({
    code: "test-grant",
    version: "1.0.0",
    metadata: {
      description: "Test Grant",
      startDate: "2023-01-01T00:00:00Z",
    },
    actions: [],
    amendablePositions: [],
    phases: [
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

// The config version first: seeding one copies an already stored version of
// the grant onto it, which the replace then overwrites with this version's own.
export const seedAdministeredGrant = async (
  db,
  code,
  { role, description, version = "1.0.0" },
) => {
  await seedConfigVersion(db, code, version);
  await db.collection("grants").replaceOne(
    { code, version },
    {
      ...new GrantDocument(
        createTestGrant({
          code,
          version,
          metadata: { description, startDate: "2023-01-01T00:00:00Z" },
          admin: role ? { role } : undefined,
        }),
      ),
    },
    { upsert: true },
  );
};

export const createGrant = async (code = "test-code-1") => {
  const payload = {
    code,
    version: "1.0.0",
    metadata: {
      description: "test description 1",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    actions: [],
    amendablePositions: [],
    phases: [
      {
        code: "PRE_AWARD",
        stages: [
          {
            code: "REVIEW_APPLICATION",
            statuses: [
              {
                code: "APPLICATION_RECEIVED",
                validFrom: [],
              },
              {
                code: "IN_REVIEW",
                validFrom: [{ code: "APPLICATION_RECEIVED", processes: [] }],
              },
              {
                code: "AGREEMENT_GENERATING",
                validFrom: [
                  { code: "IN_REVIEW", processes: ["GENERATE_OFFER"] },
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

  await insertGrant(payload);
};
