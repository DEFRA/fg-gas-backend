import { Collection, MongoClient } from "mongodb";
import { env } from "node:process";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mongoClient } from "../../src/common/mongo-client.js";
import { findApplicationsPage } from "../../src/grants/services/grant-admin.service.js";

// A ref search is one bounded, unsorted read of each series member by
// {clientRef, code}. With nothing to sort, the list indexes must not win the
// plan, even where the range alone is highly selective.

const UNIQUE_INDEX = "clientRef_1_code_1";
const IN_RANGE = "2026-06-16T00:00:00.000Z";

let client;
let applications;
let series;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  applications = client.db().collection("applications");
  series = client.db().collection("application_series");
});

afterAll(async () => {
  await client?.close();
  await mongoClient.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Most applications sit outside the searched range, which is what would make
// the created-time index tempting.
beforeEach(async () => {
  await applications.insertMany(
    Array.from({ length: 5000 }, (_, n) => ({
      clientRef: `ref-${n}`,
      code: n % 2 ? "woodland" : "frps",
      createdAt: new Date(Date.UTC(2025, 0, 1, 0, n)).toISOString(),
    })),
  );
  await applications.updateMany(
    { clientRef: { $in: ["ref-1", "ref-3", "ref-5"] } },
    { $set: { createdAt: "2026-06-17T00:00:00.000Z" } },
  );
  await series.insertOne({
    code: "woodland",
    clientRefs: ["ref-1", "ref-3", "ref-5"],
    latestClientRef: "ref-5",
    latestClientId: "client-id",
    createdAt: IN_RANGE,
    updatedAt: IN_RANGE,
  });
});

// The read the service itself builds, captured on its way to Mongo.
const searchRead = async (query) => {
  const find = vi.spyOn(Collection.prototype, "find");

  const page = await findApplicationsPage({ pageSize: 20, ...query });
  const call = find.mock.calls.find(
    (_args, index) =>
      find.mock.contexts[index].collectionName === "applications",
  );

  return { page, filter: call[0], options: call[1] };
};

const inputStages = (stage) => [
  stage,
  ...(stage.inputStage ? inputStages(stage.inputStage) : []),
  ...(stage.inputStages ?? []).flatMap(inputStages),
];

describe("an application ref search", () => {
  it.each([
    ["without a grant", {}],
    ["with a grant", { code: "woodland" }],
  ])(
    "reads every series branch by the {clientRef, code} index %s",
    async (_name, filters) => {
      const { page, filter, options } = await searchRead({
        ref: "ref-3",
        from: IN_RANGE,
        ...filters,
      });

      expect(page.rows.map((row) => row.clientRef).sort()).toEqual([
        "ref-1",
        "ref-3",
        "ref-5",
      ]);

      const plan = await applications
        .find(filter, options)
        .explain("queryPlanner");
      const scans = inputStages(plan.queryPlanner.winningPlan).filter(
        (stage) => stage.stage === "IXSCAN",
      );

      expect(filter.$or).toHaveLength(2);
      expect(scans).toHaveLength(filter.$or.length);
      for (const scan of scans) {
        expect(scan.indexName).toBe(UNIQUE_INDEX);
      }
      expect(JSON.stringify(plan.queryPlanner.winningPlan)).not.toContain(
        "COLLSCAN",
      );
    },
  );
});
