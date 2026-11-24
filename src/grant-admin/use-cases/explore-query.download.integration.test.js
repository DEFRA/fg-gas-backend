import { ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../../common/logger.js");
vi.mock("../../events/write-audit-event.js");
vi.mock("../../common/with-transaction.js", () => ({
  transactionOptions: {},
  withTransaction: (work) => work({ session: true }),
}));
vi.mock("./load-explore-vocabulary.js", async (importOriginal) => ({
  ...(await importOriginal()),
  loadExploreVocabulary: vi.fn(),
}));
vi.mock("./explore-vocabulary.use-case.js");
vi.mock("../repositories/cw-explore.repository.js", async (importOriginal) => ({
  ...(await importOriginal()),
  queryCwExplore: vi.fn(),
}));
// Room for two rows of three 1,000-character cells, and more of their
// documents, so the cells end the download first.
vi.mock("../../common/explore/query-schema.js", async (importOriginal) => ({
  ...(await importOriginal()),
  DOWNLOAD_BYTES: 7000,
}));

const DATABASE = "explore_download_scratch";
const ACTOR_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const RECORDS = 5;
const NOTE = "x".repeat(1000);

let replSet;
let mongoClient;
let db;
let exploreQueryUseCase;

const ask = (query, extra = {}) =>
  exploreQueryUseCase({
    body: { query, ...extra },
    actorId: ACTOR_ID,
    actor: "Jo Operator",
  });

const linesOf = async (stream) => {
  let text = "";

  for await (const chunk of stream) {
    text += chunk;
  }

  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
};

const at = (n) => new Date(Date.UTC(2026, 9, n + 1));

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", DATABASE);
  vi.resetModules();

  ({ mongoClient, db } = await import("../../common/mongo-client.js"));
  ({ exploreQueryUseCase } = await import("./explore-query.use-case.js"));

  await mongoClient.connect();
  await db.dropDatabase();
  await db.collection("agreements__agreements").insertMany(
    Array.from({ length: RECORDS }, (_, n) => ({
      _id: `agreement-${n}`,
      agreementNumber: `AG-${n}`,
      state: "offered",
      createdAt: at(n),
      note: NOTE,
    })),
  );

  const { registerBucket } = await import("../../common/buckets/registry.js");
  const { ensureIndexes } = await import("../../common/buckets/indexes.js");
  const { applicationsBucket } =
    await import("../../grants/buckets/applications.bucket.js");
  const applications = applicationsBucket();

  registerBucket(applications);
  await ensureIndexes(db, applications);
  await db.collection("applications").insertMany(
    Array.from({ length: RECORDS }, (_, n) => ({
      _id: new ObjectId(),
      clientRef: `client-ref-${n}`,
      code: "test-grant",
      currentConfigVersion: "1.0.0",
      currentStatus: "RECEIVED",
      createdAt: at(n).toISOString(),
      identifiers: { sbi: `10600000${n}` },
      note: NOTE,
    })),
  );
}, 120_000);

beforeEach(async () => {
  const { registerGasExploreSources } =
    await import("../../../test/helpers/explore-sources.js");
  const { ownSources } = await import("../explore/sources.js");
  const { buildVocabulary } = await import("../explore/vocabulary.js");
  const { cwExploreFailure } =
    await import("../repositories/cw-explore.repository.js");
  const { loadExploreVocabulary } =
    await import("./load-explore-vocabulary.js");
  const { exploreVocabularyUseCase } =
    await import("./explore-vocabulary.use-case.js");

  registerGasExploreSources();
  loadExploreVocabulary.mockImplementation(async () =>
    buildVocabulary({
      own: ownSources(),
      answers: [],
      cw: null,
      cwFailure: cwExploreFailure("TIMED_OUT"),
    }),
  );
  exploreVocabularyUseCase.mockResolvedValue({ sources: [] });
});

afterAll(async () => {
  await db?.dropDatabase();
  await mongoClient?.close();
  await replSet?.stop();
});

const WIDE = "{ a: '$note', b: '$note', c: '$note' }";

describe.each([
  ["a full read", `db.agreements.find({ state: 'offered' }, ${WIDE})`],
  ["an exact read", `db.applications.find({ code: 'test-grant' }, ${WIDE})`],
])("a download of %s past its cells allowance", (_, text) => {
  it.each([
    ["a CSV", { csv: true }],
    ["a CSV to its end", { csv: true, untilEnd: true }],
  ])(
    "ends %s at its last whole row, stopped by its bytes",
    async (__, asked) => {
      const answer = await ask(text, asked);

      expect(answer.read).not.toBe("windowed");
      expect(answer.rows).toHaveLength(2);
      expect(answer.download).toEqual({
        rows: 5000,
        stopped: "bytes",
        searchedTo: at(RECORDS - 2).toISOString(),
      });
    },
  );

  it("ends Download JSON at its last whole row, stopped by its bytes", async () => {
    const lines = await linesOf(
      (await ask(text, { csv: true, documents: true, stream: true })).stream,
    );

    expect(lines.filter((line) => line.row)).toHaveLength(2);
    expect(lines.at(-1).end).toMatchObject({
      stopped: "bytes",
      searchedTo: at(RECORDS - 2).toISOString(),
    });
  });
});
