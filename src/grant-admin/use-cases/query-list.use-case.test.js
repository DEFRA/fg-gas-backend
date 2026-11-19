import Boom from "@hapi/boom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refuse } from "../../common/buckets/refusal.js";
import {
  clearListGroups,
  registerListGroup,
} from "../../common/list-groups/registry.js";
import { eventListGroups } from "../../events/lists/event-list-groups.js";
import { CW_UNREACHABLE } from "../repositories/cw-http.js";
import { composeListGroups } from "../services/list-groups/catalogue.js";
import { encodeGroupCursor } from "../services/list-groups/cursor.js";
import {
  GAS_TYPES,
  anEventEntry,
} from "../services/list-groups/test-groups.js";
import { readListShell } from "../services/shell-cache.js";
import { queryBucketUseCase } from "./query-bucket.use-case.js";
import { queryListUseCase } from "./query-list.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("../services/shell-cache.js");
vi.mock("./query-bucket.use-case.js");
vi.mock("../../common/buckets/engine.js", () => ({
  readTimeoutMs: () => 5_000,
}));

const OUTBOX = {
  id: "gas.outbox",
  path: "events/gas/outbox",
  facts: [
    {
      name: "status",
      param: "status",
      values: [
        { value: "PUBLISHED", label: "Queued" },
        { value: "DEAD_LETTER", label: "Dead letter" },
      ],
      within: null,
    },
    {
      name: "lastError.name",
      param: "error",
      values: null,
      within: null,
    },
  ],
};

const catalogue = (sourceErrors = []) => ({
  catalogue: { buckets: [OUTBOX], sourceErrors },
  groups: new Map(),
});

const FROM = "2026-10-08T12:00:00.000Z";
const TO = "2026-10-09T12:00:00.000Z";

const pageOf = (ids, paging = {}) => {
  const { total, ...page } = {
    next: null,
    keepLooking: null,
    searchedTo: null,
    ...paging,
  };

  return {
    bucket: "gas.outbox",
    plan: {
      kind: "exact",
      index: [],
      bound: [],
      filled: [],
      residual: [],
      scans: 1,
    },
    rows: ids.map((id) => ({ id })),
    page: { ...page, complete: page.next === null },
    groups: [],
    ...(total === undefined ? {} : { total }),
  };
};

const ASK = {
  path: "events/gas/outbox",
  params: {},
  search: null,
  pages: 1,
  repeat: false,
  read: true,
};

const run = (ask) =>
  queryListUseCase({
    ask: { ...ASK, ...ask },
    caller: "fg-grants-platform-admin",
    actor: "Jo Operator",
  });

const payloadOf = async (promise) => {
  const error = await promise.catch((caught) => caught);

  return { statusCode: error.output.statusCode, ...error.output.payload };
};

const cwNotReached = () => {
  const failure = Boom.serverUnavailable("CW-BE could not be reached");

  failure.output.payload.errorCode = CW_UNREACHABLE;

  return failure;
};

const bodies = () => queryBucketUseCase.mock.calls.map(([args]) => args.body);

describe("queryListUseCase", () => {
  beforeEach(() => {
    readListShell.mockResolvedValue(catalogue());
    queryBucketUseCase.mockResolvedValue(pageOf(["a"]));
  });

  it("reads the list a path names, its URL params as the facts they spell", async () => {
    const answer = await run({
      params: {
        status: ["DEAD_LETTER", "PUBLISHED", ""],
        error: "TypeError",
        range: "24h",
        cursor: "ignored",
        page: "2",
        through: "3",
        searched: "1",
        clear: "all",
        audit: "on",
      },
      from: FROM,
      to: TO,
      count: true,
    });

    expect(answer).toEqual({
      bucket: "gas.outbox",
      list: {
        ...pageOf(["a"]),
        pageRows: [1],
        stopped: null,
        refusedSearch: null,
      },
    });
    expect(queryBucketUseCase).toHaveBeenCalledWith({
      bucketId: "gas.outbox",
      body: {
        where: {
          status: ["DEAD_LETTER", "PUBLISHED"],
          "lastError.name": "TypeError",
        },
        show: [],
        groupBy: [],
        limit: 20,
        from: FROM,
        to: TO,
        count: true,
      },
      caller: "fg-grants-platform-admin",
      actor: "Jo Operator",
      repeat: false,
      deadline: expect.any(Number),
    });
  });

  it("gives a fact one value as itself, and leaves out one given none", async () => {
    await run({ params: { status: "DEAD_LETTER", error: "" } });

    expect(bodies()[0].where).toEqual({ status: "DEAD_LETTER" });
  });

  it("sends the stored search, the cursor and the repeat as asked", async () => {
    await run({ search: "ref:abc-123", cursor: "c1", repeat: true });

    expect(queryBucketUseCase).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ ref: "ref:abc-123", cursor: "c1" }),
        repeat: true,
      }),
    );
  });

  describe("refusals, before any read", () => {
    it("names every problem of an address, with the list's id", async () => {
      expect(
        await payloadOf(
          run({
            params: { status: ["BOGUS"], error: ["A", "B"], colour: "x" },
          }),
        ),
      ).toEqual({
        statusCode: 400,
        error: "Bad Request",
        message: "The address names keys or values this list does not offer",
        code: "ADDRESS_REFUSED",
        problems: {
          unknownKeys: ["colour"],
          repeatedKeys: ["error"],
          unknownValues: ["status"],
        },
        bucket: "gas.outbox",
      });
      expect(queryBucketUseCase).not.toHaveBeenCalled();
    });

    it("refuses an address before its range, and when asked not to read", async () => {
      const refused = await payloadOf(
        run({ params: { colour: "x" }, from: "yesterday", read: false }),
      );

      expect(refused.code).toBe("ADDRESS_REFUSED");
    });

    it.each([
      ["a from after its to", { from: TO, to: FROM }],
      ["a from that is no instant", { from: "yesterday" }],
      ["a to that is no instant", { to: "2026-13-40" }],
    ])("refuses %s as RANGE_REFUSED", async (_, range) => {
      expect(await payloadOf(run(range))).toEqual(
        expect.objectContaining({
          statusCode: 400,
          code: "RANGE_REFUSED",
          bucket: "gas.outbox",
        }),
      );
      expect(queryBucketUseCase).not.toHaveBeenCalled();
    });

    it("still reads a GAS list while Caseworking's could not be read", async () => {
      readListShell.mockResolvedValue(catalogue([{ hop: "CW-BE" }]));

      expect((await run({})).bucket).toBe("gas.outbox");
    });

    it("answers CATALOGUE_UNAVAILABLE when there is no catalogue at all", async () => {
      readListShell.mockResolvedValue(null);

      expect(await payloadOf(run({}))).toEqual(
        expect.objectContaining({
          statusCode: 503,
          code: "CATALOGUE_UNAVAILABLE",
        }),
      );
    });

    it("refuses a filter the query cannot carry as INVALID_REQUEST", async () => {
      const many = Object.fromEntries(
        Array.from({ length: 9 }, (_, n) => [`f${n}`, { param: `f${n}` }]),
      );
      readListShell.mockResolvedValue({
        catalogue: {
          buckets: [
            {
              ...OUTBOX,
              facts: Object.values(many).map(({ param }) => ({
                name: param,
                param,
                values: null,
                within: null,
              })),
            },
          ],
          sourceErrors: [],
        },
        groups: new Map(),
      });

      const refused = await payloadOf(
        run({
          params: Object.fromEntries(Object.keys(many).map((k) => [k, "v"])),
        }),
      );

      expect(refused.reason).toBe("INVALID_REQUEST");
    });
  });

  it("checks without reading when asked not to read", async () => {
    expect(await run({ read: false, from: FROM, to: TO })).toEqual({
      bucket: "gas.outbox",
      list: null,
    });
    expect(queryBucketUseCase).not.toHaveBeenCalled();
  });

  describe("pages", () => {
    it("reads pages 1 to N in turn, every later one a repeat that counts nothing, and joins them", async () => {
      queryBucketUseCase
        .mockResolvedValueOnce(pageOf(["a", "b"], { next: "c1", total: 5 }))
        .mockResolvedValueOnce(pageOf(["c"], { keepLooking: "c2" }))
        .mockResolvedValueOnce(pageOf(["d", "e"]));

      const { list } = await run({
        pages: 4,
        count: true,
        search: "ref:abc",
      });

      expect(list.rows.map(({ id }) => id)).toEqual(["a", "b", "c", "d", "e"]);
      expect(list.pageRows).toEqual([2, 1, 2]);
      expect(list.total).toEqual(5);
      expect(list.page.next).toBeNull();
      expect(list.stopped).toBeNull();
      expect(bodies().map(({ cursor, count }) => [cursor, count])).toEqual([
        [undefined, true],
        ["c1", undefined],
        ["c2", undefined],
      ]);
      expect(bodies().every(({ ref }) => ref === "ref:abc")).toBe(true);
      expect(
        queryBucketUseCase.mock.calls.map(([{ repeat }]) => repeat),
      ).toEqual([false, true, true]);
    });

    it("stops at the page asked for, though there are more", async () => {
      queryBucketUseCase.mockResolvedValue(pageOf(["a"], { next: "n" }));

      const { list } = await run({ pages: 2 });

      expect(list.pageRows).toEqual([1, 1]);
      expect(list.page.next).toBe("n");
      expect(queryBucketUseCase).toHaveBeenCalledTimes(2);
    });

    it("reads every page by the one deadline", async () => {
      queryBucketUseCase.mockResolvedValue(pageOf(["a"], { next: "n" }));

      await run({ pages: 3 });

      const deadlines = queryBucketUseCase.mock.calls.map(
        ([{ deadline }]) => deadline,
      );
      expect(new Set(deadlines).size).toBe(1);
    });

    it("stops where a later page fails, its audit uncommitted among them, and keeps the rows before it", async () => {
      queryBucketUseCase
        .mockResolvedValueOnce(pageOf(["a"], { next: "c1" }))
        .mockResolvedValueOnce(pageOf(["b"], { next: "c2" }))
        .mockRejectedValueOnce(
          Object.assign(new Error("not written"), { auditNotWritten: true }),
        );

      const { list } = await run({ pages: 5 });

      expect(list.rows.map(({ id }) => id)).toEqual(["a", "b"]);
      expect(list.pageRows).toEqual([1, 1]);
      expect(list.stopped).toEqual({
        cursor: "c2",
        statusCode: 500,
        code: null,
      });
    });

    it("names a later page's refusal or failure by its status and code", async () => {
      queryBucketUseCase
        .mockResolvedValueOnce(pageOf(["a"], { next: "c1" }))
        .mockRejectedValueOnce(refuse("TIMED_OUT"));

      const { list } = await run({ pages: 2 });

      expect(list.stopped).toEqual({
        cursor: "c1",
        statusCode: 504,
        code: "TIMED_OUT",
      });
    });

    it("reads no later page once the deadline has passed", async () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(0);
      queryBucketUseCase.mockImplementation(async () => {
        now.mockReturnValue(5_000);

        return pageOf(["a"], { next: "c1" });
      });

      const { list } = await run({ pages: 3 });

      expect(queryBucketUseCase).toHaveBeenCalledTimes(1);
      expect(list.stopped).toEqual({
        cursor: "c1",
        statusCode: 504,
        code: "TIMED_OUT",
      });
    });

    it("passes Caseworking not reached on a list that is no group on as it failed", async () => {
      queryBucketUseCase.mockRejectedValue(cwNotReached());

      expect(await payloadOf(run({}))).toEqual({
        statusCode: 503,
        error: "Service Unavailable",
        message: "CW-BE could not be reached",
        errorCode: "CW_UNREACHABLE",
      });
    });

    it("throws the first page's failure", async () => {
      queryBucketUseCase.mockRejectedValue(refuse("TIMED_OUT"));

      await expect(run({ pages: 3 })).rejects.toThrow(
        "The read did not finish in time",
      );
    });
  });

  describe("a refused search", () => {
    it("reads the first page again without it, from the start, not as a repeat, and says why", async () => {
      queryBucketUseCase
        .mockRejectedValueOnce(refuse("UNKNOWN_REF_KIND"))
        .mockResolvedValueOnce(pageOf(["a"], { next: "c1", total: 1 }));

      const { list } = await run({
        search: "nope:abc",
        cursor: "c0",
        repeat: true,
        count: true,
      });

      expect(list.refusedSearch).toEqual({
        refusal:
          "The search names an identifier kind this bucket does not declare",
      });
      expect(list.pageRows).toEqual([1]);
      expect(bodies()[1]).not.toHaveProperty("ref");
      expect(bodies()[1]).not.toHaveProperty("cursor");
      expect(bodies()[1].count).toBe(true);
      expect(queryBucketUseCase.mock.calls[1][0].repeat).toBe(false);
    });

    it("reads nothing after the first page", async () => {
      queryBucketUseCase
        .mockRejectedValueOnce(refuse("UNKNOWN_REF_KIND"))
        .mockResolvedValueOnce(pageOf(["a"], { next: "c1" }));

      await run({ search: "nope:abc", pages: 3 });

      expect(queryBucketUseCase).toHaveBeenCalledTimes(2);
    });

    it("names no refusal it does not know", async () => {
      queryBucketUseCase
        .mockRejectedValueOnce(Boom.badRequest("anything at all"))
        .mockResolvedValueOnce(pageOf(["a"]));

      const { list } = await run({ search: "ref:abc" });

      expect(list.refusedSearch).toEqual({ refusal: null });
    });

    it("throws a refusal of a browse, which has no search to drop", async () => {
      queryBucketUseCase.mockRejectedValue(refuse("INVALID_CURSOR"));

      await expect(run({ cursor: "bad" })).rejects.toThrow(
        "The cursor cannot be read",
      );
      expect(queryBucketUseCase).toHaveBeenCalledTimes(1);
    });

    it("throws a failure that is no refusal, a search's too", async () => {
      queryBucketUseCase.mockRejectedValue(Boom.badGateway("CW-BE down"));

      await expect(run({ search: "ref:abc" })).rejects.toThrow("CW-BE down");
      expect(queryBucketUseCase).toHaveBeenCalledTimes(1);
    });
  });
});

describe("queryListUseCase for a list group", () => {
  let composed;

  const groupPage = (bucket, ids) => ({
    ...pageOf(ids),
    bucket,
    rows: ids.map((id, n) => ({
      id,
      time: `2026-10-15T10:00:0${n}.000Z`,
      title: "Event",
      subtitle: null,
      cells: {},
      link: null,
    })),
  });

  const runGroup = (ask) => run({ path: "events/gas", ...ask });

  beforeEach(() => {
    clearListGroups();
    eventListGroups().forEach(registerListGroup);
    composed = composeListGroups(
      [
        anEventEntry("gas.outbox", GAS_TYPES.outbox),
        anEventEntry("gas.inbox", GAS_TYPES.inbox),
      ],
      { cwRead: false },
    );
    readListShell.mockResolvedValue({
      catalogue: { buckets: composed.buckets, sourceErrors: [] },
      groups: composed.views,
    });
    queryBucketUseCase.mockImplementation(async ({ bucketId }) =>
      groupPage(bucketId, bucketId === "gas.outbox" ? ["0a"] : ["0b"]),
    );
  });

  afterEach(() => {
    clearListGroups();
  });

  it("reads each picked box as the list's own read, with the operator, the deadline and one signal", async () => {
    const { bucket, list } = await runGroup({
      params: { queue: ["outbox", "inbox"], status: "DEAD_LETTER" },
      repeat: true,
      count: true,
    });
    const calls = queryBucketUseCase.mock.calls.map(([args]) => args);

    expect(bucket).toBe("gas.events");
    expect(list.rows.map(({ cells }) => cells.box)).toEqual([
      "inbox",
      "outbox",
    ]);
    expect(
      calls.map(({ bucketId, body, caller, actor, repeat }) => ({
        bucketId,
        where: body.where,
        caller,
        actor,
        repeat,
      })),
    ).toEqual([
      {
        bucketId: "gas.outbox",
        where: { status: "DEAD_LETTER" },
        caller: "fg-grants-platform-admin",
        actor: "Jo Operator",
        repeat: true,
      },
      {
        bucketId: "gas.inbox",
        where: { status: "DEAD_LETTER" },
        caller: "fg-grants-platform-admin",
        actor: "Jo Operator",
        repeat: true,
      },
    ]);
    expect(calls[0].deadline).toBe(calls[1].deadline);
    expect(calls[0].signal).toBe(calls[1].signal);
  });

  it("names no queue when Caseworking can't be reached at all", async () => {
    queryBucketUseCase.mockImplementation(async ({ bucketId }) => {
      if (bucketId === "gas.inbox") {
        throw cwNotReached();
      }

      return groupPage(bucketId, ["0a"]);
    });

    const refused = await payloadOf(runGroup({}));

    expect(refused).toEqual({
      statusCode: 503,
      error: "Service Unavailable",
      message: "CW-BE lists could not be read",
      code: "CW_UNREACHABLE",
    });
  });

  it("fails a later page Caseworking can't be reached for as that queue's read", async () => {
    queryBucketUseCase.mockImplementation(async ({ bucketId }) => {
      if (bucketId === "gas.inbox") {
        throw cwNotReached();
      }

      return groupPage(bucketId, ["0a"]);
    });
    const cursor = encodeGroupCursor({
      positions: {
        "gas.outbox": { t: "2026-10-08T12:00:00.000Z", i: "0".repeat(24) },
        "gas.inbox": { t: "2026-10-08T12:00:00.000Z", i: "0".repeat(24) },
      },
      bounded: [],
    });

    const refused = await payloadOf(runGroup({ cursor }));

    expect(refused).toMatchObject({
      statusCode: 503,
      errorCode: "CW_UNREACHABLE",
      queue: "inbox",
    });
    expect(refused).not.toHaveProperty("code");
  });

  it("refuses a queue it doesn't offer, and takes one given twice", async () => {
    expect(
      (await payloadOf(runGroup({ params: { queue: "foo" } }))).problems,
    ).toEqual({ unknownKeys: [], repeatedKeys: [], unknownValues: ["queue"] });

    await expect(
      runGroup({ params: { queue: ["inbox", "inbox"] } }),
    ).resolves.toMatchObject({ bucket: "gas.events" });
  });

  it("refuses a queue on a list that is no group", async () => {
    readListShell.mockResolvedValue(catalogue());

    expect(
      (await payloadOf(run({ params: { queue: "inbox" } }))).problems
        .unknownKeys,
    ).toEqual(["queue"]);
  });

  it("refuses a cursor it can't read as a failed list, never a refused search", async () => {
    const refused = await payloadOf(
      runGroup({ cursor: "bad", search: "ref:abc" }),
    );

    expect(refused).toMatchObject({
      statusCode: 400,
      reason: "INVALID_CURSOR",
    });
    expect(queryBucketUseCase).not.toHaveBeenCalled();
  });

  it("reads a list again without a search no box may take, and says so", async () => {
    const { list } = await runGroup({ search: "config:woodland@1.0.0" });

    expect(list.refusedSearch).toEqual({
      refusal:
        "The search names an identifier kind this bucket does not declare",
    });
    expect(list.rows).toHaveLength(2);
    expect(bodies().every((body) => body.ref === undefined)).toBe(true);
  });

  it("restores pages 1 to N of a group under the one deadline", async () => {
    queryBucketUseCase.mockImplementation(async ({ bucketId, body }) => {
      const offset = body.cursor === undefined ? 0 : 20;
      const ids = Array.from({ length: 20 }, (_, n) =>
        (bucketId === "gas.outbox" ? n + offset : 50 + n + offset)
          .toString(16)
          .padStart(24, "0"),
      );

      return {
        ...groupPage(bucketId, []),
        rows: ids.map((id, n) => ({
          id,
          time: new Date(
            Date.UTC(2026, 9, 15, 10) - (n + offset) * 1000,
          ).toISOString(),
          title: "Event",
          subtitle: null,
          cells: {},
          link: null,
        })),
        page: {
          next: offset === 0 ? "more" : null,
          keepLooking: null,
          searchedTo: null,
          complete: offset !== 0,
        },
      };
    });

    const { list } = await runGroup({ pages: 2 });

    expect(list.pageRows).toEqual([20, 20]);
    expect(list.stopped).toBeNull();
  });

  it("names the queue that failed a group's restore, and keeps the pages before it", async () => {
    queryBucketUseCase.mockImplementation(async ({ bucketId, body }) => {
      if (body.cursor !== undefined && bucketId === "gas.inbox") {
        throw refuse("TIMED_OUT");
      }

      return {
        ...groupPage(bucketId, [
          (bucketId === "gas.outbox" ? "a" : "b").padStart(24, "0"),
        ]),
        page: {
          next: "more",
          keepLooking: null,
          searchedTo: null,
          complete: false,
        },
      };
    });

    const { list } = await runGroup({ pages: 2 });

    expect(list.pageRows).toEqual([1]);
    expect(list.stopped).toEqual({
      cursor: expect.any(String),
      statusCode: 504,
      code: "TIMED_OUT",
      queue: "inbox",
    });
  });
});
