import { ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
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
// Each start cut counts, so a test can run the clock out after the nth.
const cut = vi.hoisted(() => ({ n: 0, after: Infinity }));

vi.mock("../../common/explore/document-start.js", async (importOriginal) => {
  const actual = await importOriginal();
  const now = Date.now.bind(Date);

  return {
    ...actual,
    startOf: (buf) => {
      cut.n += 1;

      if (cut.n === cut.after) {
        vi.spyOn(Date, "now").mockImplementation(() => now() + 9_500);
      }

      return actual.startOf(buf);
    },
  };
});

const DATABASE = "explore_starts_scratch";
const ACTOR_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const RECORDS = 40;
const TEXT = "db.applications.find({ note: /n/ }, { clientRef: 1 })";

let replSet;
let mongoClient;
let db;
let exploreQueryUseCase;

const ask = (extra = {}) =>
  exploreQueryUseCase({
    body: { query: TEXT, starts: true, ...extra },
    actorId: ACTOR_ID,
    actor: "Jo Operator",
  });

const idsOf = (answer) => answer.rows.map(({ id }) => id);

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", DATABASE);
  vi.resetModules();

  ({ mongoClient, db } = await import("../../common/mongo-client.js"));
  ({ exploreQueryUseCase } = await import("./explore-query.use-case.js"));

  await mongoClient.connect();
  await db.dropDatabase();

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
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
      note: "n".repeat(20_000),
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
  cut.n = 0;
  cut.after = Infinity;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db?.dropDatabase();
  await mongoClient?.close();
  await replSet?.stop();
});

describe("a starts page read out of time", () => {
  it("ends at the last start read, and Keep looking goes on at exactly the next record", async () => {
    const whole = await ask();

    expect(whole.read).toBe("windowed");
    expect(whole.rows).toHaveLength(RECORDS);

    cut.n = 0;
    cut.after = 7;

    const first = await ask();

    vi.restoreAllMocks();
    cut.after = Infinity;

    const read = first.rows.length;
    const next = await ask({ positions: first.window.positions });

    expect(read).toBeGreaterThan(0);
    expect(read).toBeLessThan(RECORDS);
    expect(first.partial).toBe(true);
    expect(first.rows.every(({ start }) => start !== null)).toBe(true);
    expect([...idsOf(first), ...idsOf(next)]).toEqual(idsOf(whole));
  });
});
