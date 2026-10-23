import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { up as stampConfigVersionLinks } from "../../migrations/20261025100000-stamp-config-version-links.js";
import { logger } from "../../src/common/logger.js";

const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const TRACE = "trace:4bf92f3577b34da6a3ce929d0e0e4736";

let client;
let inbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  inbox = client.db().collection("inbox");
});

afterAll(async () => {
  await client?.close();
});

const migrate = () => stampConfigVersionLinks(client.db());

const configVersionRow = (grantCode, overrides = {}, version = "1.0.0") => {
  const messageId = new ObjectId().toHexString();

  return {
    _id: new ObjectId(),
    source: "CB",
    status: "COMPLETED",
    publicationDate: "2026-10-01T10:00:00.000Z",
    messageId,
    traceparent: TRACEPARENT,
    type: "config-version.updated",
    segregationRef: grantCode ?? "unknown-grant",
    event: {
      id: messageId,
      type: "config-version.updated",
      data: { grantCode, version, status: "active" },
    },
    eventType: "ConfigVersionUpdated",
    refs: [`id:${messageId}`, TRACE],
    ...overrides,
  };
};

const refsOf = async (_id) => (await inbox.findOne({ _id })).refs;

const everyRow = () => inbox.find().sort({ _id: 1 }).toArray();

const writingNothing = () =>
  vi
    .spyOn(inbox.constructor.prototype, "bulkWrite")
    .mockResolvedValue({ ok: 1 });

describe("stamping config version events with their code and version", () => {
  it("stamps the code as a reference, and the code and version as a link", async () => {
    const row = configVersionRow("woodland-creation");
    await inbox.insertOne(row);

    await migrate();

    expect(await refsOf(row._id)).toEqual([
      `id:${row.messageId}`,
      TRACE,
      "ref:woodland-creation",
      "config:woodland-creation@1~2e.0~2e.0",
    ]);
  });

  it("adds the version link to a row linked by its code alone", async () => {
    const row = configVersionRow("woodland-creation");
    row.refs.push("ref:woodland-creation", "config:woodland-creation");
    await inbox.insertOne(row);

    await migrate();

    expect(await refsOf(row._id)).toEqual([
      `id:${row.messageId}`,
      TRACE,
      "ref:woodland-creation",
      "config:woodland-creation",
      "config:woodland-creation@1~2e.0~2e.0",
    ]);
  });

  it("reads the code and version the writer saw, from an edited row's original payload", async () => {
    const row = configVersionRow("edited-code");
    row.originalPayload = {
      ...row.event,
      data: { ...row.event.data, grantCode: "woodland-creation" },
    };
    await inbox.insertOne(row);

    await migrate();

    expect(await refsOf(row._id)).toContain(
      "config:woodland-creation@1~2e.0~2e.0",
    );
  });

  it("keeps a mixed-case code's case in its link", async () => {
    const row = configVersionRow("Woodland");
    await inbox.insertOne(row);

    await migrate();

    expect(await refsOf(row._id)).toEqual(
      expect.arrayContaining([
        "ref:woodland",
        "config:~57.oodland@1~2e.0~2e.0",
      ]),
    );
  });

  it("leaves other event types alone", async () => {
    const row = {
      _id: new ObjectId(),
      status: "COMPLETED",
      publicationDate: "2026-10-01T10:00:00.000Z",
      event: {
        id: "0b7c1d1e-0000-4000-8000-000000000001",
        type: "cloud.defra.local.fg-cw-backend.case.status.updated",
        data: { caseRef: "abc-123", workflowCode: "woodland-creation" },
      },
      eventType: "CaseStatusUpdated",
      refs: ["id:0b7c1d1e-0000-4000-8000-000000000001"],
    };
    await inbox.insertOne(row);

    await migrate();

    expect(await inbox.findOne({ _id: row._id })).toEqual(row);
  });

  it("stamps the code of a row that names no version, and says how many have no link", async () => {
    const info = vi.spyOn(logger, "info");
    const row = configVersionRow("woodland-creation", {}, null);
    await inbox.insertOne(row);

    await migrate();

    expect(await refsOf(row._id)).toEqual([
      `id:${row.messageId}`,
      TRACE,
      "ref:woodland-creation",
    ]);
    expect(info).toHaveBeenCalledWith(
      "1 ConfigVersionUpdated rows lack a grant code or a version, so have no version link",
    );
  });

  it("leaves a row that names no grant as it is, and says how many have no link", async () => {
    const info = vi.spyOn(logger, "info");
    const row = configVersionRow(null);
    await inbox.insertOne(row);

    await migrate();

    expect(await inbox.findOne({ _id: row._id })).toEqual(row);
    expect(info).toHaveBeenCalledWith(
      "1 ConfigVersionUpdated rows lack a grant code or a version, so have no version link",
    );
  });

  it("leaves a row that was never stamped as it is, and says how many", async () => {
    const warn = vi.spyOn(logger, "warn");
    const row = configVersionRow("woodland-creation", { refs: null });
    const { refs, ...noRefs } = configVersionRow("woodland-creation");
    await inbox.insertMany([row, noRefs]);

    await migrate();

    expect(await inbox.findOne({ _id: row._id })).toEqual(row);
    expect(await inbox.findOne({ _id: noRefs._id })).toEqual(noRefs);
    expect(warn).toHaveBeenCalledWith(
      "2 ConfigVersionUpdated rows were never stamped, so are left as stored",
    );
  });

  it("keeps a ref a live writer adds while it runs", async () => {
    const row = configVersionRow("woodland-creation");
    await inbox.insertOne(row);
    const { bulkWrite } = inbox.constructor.prototype;
    vi.spyOn(inbox.constructor.prototype, "bulkWrite").mockImplementation(
      async function (...args) {
        await this.updateOne(
          { _id: row._id },
          { $addToSet: { refs: "ref:written-meanwhile" } },
        );

        return bulkWrite.apply(this, args);
      },
    );

    await migrate();

    expect(await refsOf(row._id)).toEqual([
      `id:${row.messageId}`,
      TRACE,
      "ref:written-meanwhile",
      "ref:woodland-creation",
      "config:woodland-creation@1~2e.0~2e.0",
    ]);
  });

  it("leaves a row written after it started to its writer", async () => {
    await inbox.insertOne(configVersionRow("woodland-creation"));
    const late = configVersionRow("woodland-creation");
    const { bulkWrite } = inbox.constructor.prototype;
    vi.spyOn(inbox.constructor.prototype, "bulkWrite").mockImplementation(
      async function (...args) {
        await this.insertOne(late);

        return bulkWrite.apply(this, args);
      },
    );

    await migrate();

    expect(await inbox.findOne({ _id: late._id })).toEqual(late);
  });

  it("stamps more rows than it reads in one batch", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) =>
      configVersionRow(`grant-${i}`),
    );
    await inbox.insertMany(rows);

    await migrate();

    expect(
      await inbox.countDocuments({
        refs: { $elemMatch: { $gte: "config:", $lt: "config;" } },
      }),
    ).toBe(1001);
  });

  it("changes nothing when it runs again", async () => {
    await inbox.insertMany([
      configVersionRow("woodland-creation"),
      configVersionRow("Woodland"),
      configVersionRow("woodland-creation", {}, null),
      configVersionRow(null),
    ]);
    await migrate();
    const once = await everyRow();
    const bulkWrite = vi.spyOn(inbox.constructor.prototype, "bulkWrite");

    await migrate();

    expect(bulkWrite).not.toHaveBeenCalled();
    expect(await everyRow()).toEqual(once);
  });

  it("does nothing on an empty inbox", async () => {
    await expect(migrate()).resolves.toBeUndefined();
  });

  it("fails when a row is left without its refs", async () => {
    await inbox.insertMany([
      configVersionRow("woodland-creation"),
      configVersionRow("woodland-creation", {}, null),
    ]);
    writingNothing();

    await expect(migrate()).rejects.toThrow(
      "2 ConfigVersionUpdated inbox rows were left without their refs",
    );
  });
});
