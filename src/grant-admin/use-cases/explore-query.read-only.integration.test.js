import { BSON, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  expectReadsOnly,
  spyCollections,
} from "../../../test/helpers/explore-read-only.js";

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

const DATABASE = "explore_read_only_scratch";
const ACTOR_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const AGREEMENTS = "agreements__agreements";

let replSet;
let mongoClient;
let db;
let exploreQueryUseCase;
let queryCwExplore;
const ids = ["agreement-0", "agreement-1", "agreement-2"];
const applicationIds = [new ObjectId(), new ObjectId()];

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

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", DATABASE);
  vi.resetModules();

  ({ mongoClient, db } = await import("../../common/mongo-client.js"));
  ({ exploreQueryUseCase } = await import("./explore-query.use-case.js"));
  ({ queryCwExplore } =
    await import("../repositories/cw-explore.repository.js"));

  await mongoClient.connect();
  await db.dropDatabase();
  await db.collection(AGREEMENTS).insertMany(
    ids.map((_id, n) => ({
      _id,
      agreementNumber: `AG-${n}`,
      state: n ? "offered" : "accepted",
      terms: { years: n + 1 },
      createdAt: new Date(Date.UTC(2026, 9, n + 1)),
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
    applicationIds.map((_id, n) => ({
      _id,
      clientRef: `client-ref-${n}`,
      code: "test-grant",
      currentConfigVersion: "1.0.0",
      currentStatus: "RECEIVED",
      createdAt: new Date(Date.UTC(2026, 9, n + 1)).toISOString(),
      identifiers: { sbi: `10600000${n}` },
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

it("answers documents, Show it, Download JSON and groups through the read-only view alone, writing nothing", async () => {
  const spied = spyCollections();
  const text = "db.agreements.find({ state: 'offered' })";

  const page = await ask(text, { documents: true });
  const shown = await ask(text, {
    show: {
      id: BSON.serialize({ _id: ids[1] }).toString("base64"),
      at: [],
      service: null,
      box: null,
    },
  });
  const download = await linesOf(
    (await ask(text, { csv: true, documents: true, stream: true })).stream,
  );
  const grouped = await ask(
    "db.agreements.aggregate([{ $group: { _id: '$state', n: { $count: {} } } }])",
  );

  expect(page.rows).toHaveLength(2);
  expect(page.rows.every((row) => row.doc)).toBe(true);
  expect(shown.rows).toHaveLength(1);
  expect(shown.rows[0].doc).toBeTruthy();
  expect(download.filter((line) => line.row)).toHaveLength(2);
  expect(grouped.rows).toHaveLength(2);
  expect(queryCwExplore).not.toHaveBeenCalled();
  expect(spied.reads.some(({ name }) => name === "aggregate")).toBe(true);
  expectReadsOnly(spied);
});

it("says a Show it row without documents asked, as for the Table, changed when its record no longer passes the run's filter", async () => {
  const spied = spyCollections();
  const text = "db.agreements.find({ state: 'offered' })";
  const showOf = (_id) => ({
    show: {
      id: BSON.serialize({ _id }).toString("base64"),
      at: [],
      service: null,
      box: null,
    },
  });

  const changed = await ask(text, showOf(ids[0]));
  const same = await ask(text, showOf(ids[1]));

  expect(changed.rows).toHaveLength(1);
  expect(changed.rows[0].cells).toBeTruthy();
  expect(changed.rows[0].docNote).toEqual({ changed: true });
  expect(changed.documents.gone).toBe(false);
  expect(same.rows[0].docNote).toBeNull();
  expectReadsOnly(spied);
});

it.each(["state", "terms"])(
  "shows the row $unwind makes of a record whose %s isn't a list, at no position",
  async (path) => {
    const text = `db.agreements.aggregate([{ $match: { state: 'offered' } }, { $unwind: '$${path}' }])`;

    const page = await ask(text, { documents: true });
    const shown = await ask(text, {
      show: {
        id: page.rows[0].id,
        at: page.rows[0].at,
        service: null,
        box: null,
      },
    });

    expect(page.rows.map(({ at }) => at)).toEqual([[null], [null]]);
    expect(shown.rows).toHaveLength(1);
    expect(shown.rows[0]).toMatchObject({ at: [null], docNote: null });
    expect(shown.rows[0].doc).toBeTruthy();
  },
);

it("answers a bucket source's documents, Show it by _id and Download JSON through the read-only view alone, writing nothing", async () => {
  const spied = spyCollections();
  const text = "db.applications.find({ code: 'test-grant' })";

  const page = await ask(text, { documents: true });
  const byId = await ask(
    `db.applications.find({ _id: ObjectId('${applicationIds[0].toHexString()}') })`,
    { documents: true },
  );
  const shown = await ask(text, {
    show: {
      id: BSON.serialize({ _id: applicationIds[1] }).toString("base64"),
      at: [],
      service: null,
      box: null,
    },
  });
  const download = await linesOf(
    (await ask(text, { csv: true, documents: true, stream: true })).stream,
  );

  expect(page.rows).toHaveLength(2);
  expect(page.rows.every((row) => row.doc)).toBe(true);
  expect(byId.rows).toHaveLength(1);
  expect(shown.rows).toHaveLength(1);
  expect(shown.rows[0].doc).toBeTruthy();
  expect(download.filter((line) => line.row)).toHaveLength(2);
  expect(queryCwExplore).not.toHaveBeenCalled();
  expect(new Set(spied.reads.map(({ name }) => name))).toEqual(
    new Set(["find", "aggregate", "countDocuments"]),
  );
  expectReadsOnly(spied);
});
