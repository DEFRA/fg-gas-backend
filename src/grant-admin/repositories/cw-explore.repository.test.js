import Boom from "@hapi/boom";
import { BSON } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  accumulate,
  partialValue,
  sentPartial,
} from "../../common/explore/evaluate.js";
import { mergeGroups } from "../../common/explore/merge.js";
import { refusalOf } from "../../common/explore/refusal.js";
import { wreck } from "../../common/wreck.js";
import { cwRequest } from "./cw-http.js";
import {
  findCwExploreSources,
  maxBytesOf,
  queryCwExplore,
} from "./cw-explore.repository.js";

const { cwBackend } = vi.hoisted(() => ({
  cwBackend: { url: undefined, token: undefined },
}));

vi.mock("../../common/config.js", () => ({ config: { cwBackend } }));
vi.mock("../../common/logger.js");
vi.mock("../../common/wreck.js", () => ({
  wreck: { get: vi.fn(), post: vi.fn(), request: vi.fn(), read: vi.fn() },
}));

const SOURCES = {
  sources: [
    {
      name: "cases",
      label: "Cases, in Caseworking",
      service: "CW",
      size: "big",
      noun: { one: "case", many: "cases" },
      star: ["caseRef", "payload.identifiers.sbi"],
      time: "createdAt",
      roots: ["caseRef", "payload", "definition.phases"],
      answersAt: "payload.answers",
      paths: [
        {
          path: "caseRef",
          type: "text",
          index: "ref",
          closed: false,
          within: null,
          scans: 1,
          later: "a key added later",
        },
        {
          path: "createdAt",
          type: "date",
          index: "time",
          closed: false,
          within: null,
          stored: "date",
        },
        {
          path: "currentConfigVersion",
          index: "fact",
          closed: false,
          within: "workflowCode",
        },
      ],
      later: true,
    },
  ],
  later: true,
};

const PART = { read: "exact", boxes: [], groups: null };

const httpError = (statusCode, body) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: {
      payload:
        body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
    },
  });

const failure = (promise) => promise.catch((error) => error);

beforeEach(() => {
  cwBackend.url = "http://cw.test";
  cwBackend.token = "cw-token";
  cwBackend.timeoutMs = 3000;
});

describe("findCwExploreSources", () => {
  it("reads Caseworking's sources, keys it adds later too", async () => {
    wreck.get.mockResolvedValue({ payload: SOURCES });

    expect(await findCwExploreSources()).toEqual(SOURCES);
    expect(wreck.get.mock.calls[0][0]).toBe(
      "http://cw.test/actuators/explore/sources",
    );
  });

  it("says Caseworking errored when it has no route", async () => {
    wreck.get.mockRejectedValue(httpError(404));

    expect(
      (await failure(findCwExploreSources())).output.payload,
    ).toMatchObject({
      statusCode: 502,
      hop: "CW-BE",
      reason: "ERRORED",
    });
  });

  it.each([
    [
      "it is unreachable",
      Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
      "UNREACHABLE",
    ],
    ["it times out", httpError(504), "TIMED_OUT"],
    ["it fails", httpError(500), "ERRORED"],
  ])("says why when %s", async (_, error, reason) => {
    wreck.get.mockRejectedValue(error);

    expect((await failure(findCwExploreSources())).output.payload.reason).toBe(
      reason,
    );
  });

  it("refuses an answer it can't read", async () => {
    wreck.get.mockResolvedValue({ payload: {} });

    expect((await failure(findCwExploreSources())).output.payload.reason).toBe(
      "ERRORED",
    );
  });
});

describe("queryCwExplore", () => {
  it("posts the Query with the operator, and reads the part", async () => {
    wreck.post.mockResolvedValue({ payload: PART });

    expect(
      await queryCwExplore({ v: 1 }, { actor: "Jo", timeLeftMs: 6000 }),
    ).toEqual(PART);

    const [url, options] = wreck.post.mock.calls[0];

    expect(url).toBe("http://cw.test/actuators/explore/query");
    expect(options.payload).toEqual({ v: 1 });
    expect(options.headers["x-actor"]).toBe("Jo");
    expect(options.headers["x-explore-time-left-ms"]).toBe("5500");
    expect(options.timeout).toBe(6000);
  });

  it("reads a sum that overflowed across Caseworking's boxes, and adds GAS's to it either way", async () => {
    const groupOf = (values) => ({
      key: "s:DEAD_LETTER",
      value: "DEAD_LETTER",
      n: values.length,
      aggs: {
        "sum(x)": sentPartial(
          "sum",
          values.reduce((sofar, x) => accumulate("sum", sofar, x), undefined),
        ),
      },
    });
    const cwGroups = mergeGroups([[groupOf([1e308])], [groupOf([1e308])]]);
    wreck.post.mockResolvedValue({
      payload: JSON.parse(JSON.stringify({ ...PART, groups: cwGroups })),
    });

    const { groups } = await queryCwExplore(
      { v: 1 },
      { actor: "Jo", timeLeftMs: 6000 },
    );
    const sumOf = (lists) =>
      Number(partialValue("sum", mergeGroups(lists)[0].aggs["sum(x)"]));

    expect(sumOf([groups])).toBe(Infinity);
    expect(sumOf([[groupOf([5])], groups])).toBe(Infinity);
    expect(sumOf([groups, [groupOf([5])]])).toBe(Infinity);
  });

  it("says Caseworking refused a Query it can't read", async () => {
    wreck.post.mockRejectedValue(
      httpError(400, { reason: "EXPLORE_QUERY_INVALID" }),
    );

    expect(
      (await failure(queryCwExplore({}, { timeLeftMs: 5000 }))).output.payload,
    ).toMatchObject({
      hop: "CW-BE",
      reason: "EXPLORE_QUERY_INVALID",
    });
  });

  it("reads only the code of a refusal, and never its text", async () => {
    wreck.post.mockRejectedValue(
      httpError(400, {
        reason: "EXPLORE_QUERY_REFUSED",
        refusal: "TOO_MANY_TO_COUNT",
        message: "sentinel",
      }),
    );

    const error = await failure(queryCwExplore({}, { timeLeftMs: 5000 }));

    expect(refusalOf(error)).toBe("TOO_MANY_TO_COUNT");
    expect(error.service).toBe("CW");
    expect(error.message).not.toContain("sentinel");
  });

  it("reads a path off Caseworking's lists as its refusal", async () => {
    wreck.post.mockRejectedValue(
      httpError(400, {
        reason: "EXPLORE_QUERY_REFUSED",
        refusal: "PATH_NOT_ALLOWED",
      }),
    );

    const error = await failure(queryCwExplore({}, { timeLeftMs: 5000 }));

    expect(refusalOf(error)).toBe("PATH_NOT_ALLOWED");
    expect(error.service).toBe("CW");
  });

  it("reads a refusal it doesn't know as an error, and busy as busy", async () => {
    wreck.post.mockRejectedValueOnce(
      httpError(400, { reason: "EXPLORE_QUERY_REFUSED", refusal: "$where" }),
    );
    wreck.post.mockRejectedValueOnce(httpError(429, {}));

    expect(
      (await failure(queryCwExplore({}, { timeLeftMs: 5000 }))).output.payload
        .reason,
    ).toBe("ERRORED");
    expect(
      refusalOf(await failure(queryCwExplore({}, { timeLeftMs: 5000 }))),
    ).toBe("BUSY");
  });

  it("tells busy with the operator's last query from busy with as many as Caseworking runs", async () => {
    wreck.post.mockRejectedValueOnce(httpError(429, { refusal: "FULL" }));
    wreck.post.mockRejectedValueOnce(httpError(429, { refusal: "$x" }));

    expect(
      refusalOf(await failure(queryCwExplore({}, { timeLeftMs: 5000 }))),
    ).toBe("FULL");
    expect(
      refusalOf(await failure(queryCwExplore({}, { timeLeftMs: 5000 }))),
    ).toBe("BUSY");
  });

  it("keeps why Caseworking's read couldn't be exact, where GAS knows the reason", async () => {
    wreck.post.mockRejectedValueOnce(
      httpError(400, {
        reason: "EXPLORE_QUERY_REFUSED",
        refusal: "GROUP_NEEDS_EXACT",
        detail: { why: "SECOND_REF", path: "payload.identifiers.sbi" },
      }),
    );
    wreck.post.mockRejectedValueOnce(
      httpError(400, {
        reason: "EXPLORE_QUERY_REFUSED",
        refusal: "GROUP_NEEDS_EXACT",
        detail: { why: "NOT_INDEXED", path: "payload..sortCode" },
      }),
    );
    wreck.post.mockRejectedValueOnce(
      httpError(400, {
        reason: "EXPLORE_QUERY_REFUSED",
        refusal: "GROUP_NEEDS_EXACT",
        detail: { why: "$where", path: { $gt: "" } },
      }),
    );

    expect(
      (await failure(queryCwExplore({}, { timeLeftMs: 5000 }))).detail,
    ).toEqual({ why: "SECOND_REF", path: "payload.identifiers.sbi" });
    expect(
      (await failure(queryCwExplore({}, { timeLeftMs: 5000 }))).detail,
    ).toEqual({ why: "NOT_INDEXED", path: null });
    expect(
      (await failure(queryCwExplore({}, { timeLeftMs: 5000 }))).detail,
    ).toBeNull();
  });

  it("keeps what Caseworking had too many of, where it names it in plain words", async () => {
    wreck.post.mockRejectedValueOnce(
      httpError(400, {
        reason: "EXPLORE_QUERY_REFUSED",
        refusal: "TOO_BIG",
        detail: { why: null, path: null, noun: "workflow definitions" },
      }),
    );
    wreck.post.mockRejectedValueOnce(
      httpError(400, {
        reason: "EXPLORE_QUERY_REFUSED",
        refusal: "TOO_BIG",
        detail: { why: null, path: null, noun: "<b>workflows</b>" },
      }),
    );
    wreck.post.mockRejectedValueOnce(
      httpError(400, {
        reason: "EXPLORE_QUERY_REFUSED",
        refusal: "TOO_BIG",
        detail: { why: null, path: null, noun: { many: "workflows" } },
      }),
    );

    const named = await failure(queryCwExplore({}, { timeLeftMs: 5000 }));

    expect(refusalOf(named)).toBe("TOO_BIG");
    expect(named.detail).toEqual({
      why: null,
      path: null,
      noun: "workflow definitions",
    });
    expect(
      (await failure(queryCwExplore({}, { timeLeftMs: 5000 }))).detail,
    ).toBeNull();
    expect(
      (await failure(queryCwExplore({}, { timeLeftMs: 5000 }))).detail,
    ).toBeNull();
  });

  it("refuses as too slow, naming Caseworking, when too little time is left to ask", async () => {
    const error = await failure(queryCwExplore({}, { timeLeftMs: 400 }));

    expect(refusalOf(error)).toBe("TOO_SLOW");
    expect(error.service).toBe("CW");
    expect(wreck.post).not.toHaveBeenCalled();
  });

  describe("with a signal to stop it", () => {
    const pending = (res) =>
      Object.assign(Promise.resolve(res), { req: { destroy: vi.fn() } });

    it("reads the answer as the shortcut would", async () => {
      wreck.request.mockReturnValue(pending({ statusCode: 200 }));
      wreck.read.mockResolvedValue(PART);

      expect(
        await queryCwExplore(
          { v: 1 },
          { timeLeftMs: 5000, signal: new AbortController().signal },
        ),
      ).toEqual(PART);
      expect(wreck.request.mock.calls[0][0]).toBe("POST");
    });

    it("reads a refusal as the shortcut would", async () => {
      wreck.request.mockReturnValue(pending({ statusCode: 429, headers: {} }));
      wreck.read.mockResolvedValue({ reason: "EXPLORE_QUERY_BUSY" });

      const error = await failure(
        queryCwExplore(
          {},
          { timeLeftMs: 5000, signal: new AbortController().signal },
        ),
      );

      expect(refusalOf(error)).toBe("BUSY");
    });

    it("ends the request when the caller stops", async () => {
      const stop = new AbortController();
      const request = Object.assign(new Promise(() => {}), {
        req: { destroy: vi.fn() },
      });

      wreck.request.mockReturnValue(request);
      queryCwExplore({}, { timeLeftMs: 5000, signal: stop.signal });
      stop.abort();

      expect(request.req.destroy).toHaveBeenCalled();
    });
  });

  describe("bounded by maxBytes", () => {
    const MIB = 1024 * 1024;
    const ROWS = 10_000 * 1024;
    const pending = (res) =>
      Object.assign(Promise.resolve(res), { req: { destroy: vi.fn() } });
    const signal = () => new AbortController().signal;

    it("allows a page the cells it holds, a CSV its download's and a fetch its documents in base64, or one row's, beside its rows", () => {
      expect(maxBytesOf({ mode: "rows" })).toBe(ROWS + 8 * MIB);
      expect(maxBytesOf({ mode: "rows", cellBytes: 256 * MIB })).toBe(
        ROWS + 256 * MIB,
      );
      expect(
        maxBytesOf({ mode: "documents", documents: { bytes: 64 * MIB } }),
      ).toBe(ROWS + Math.ceil((64 * MIB) / 3) * 4);
      expect(
        maxBytesOf({ mode: "documents", documents: { bytes: 1 * MIB } }),
      ).toBe(ROWS + Math.ceil((32 * MIB) / 3) * 4);
      expect(
        maxBytesOf({
          mode: "documents",
          documents: { mode: "starts" },
          rows: [{}, {}],
        }),
      ).toBe(ROWS + 2 * Math.ceil((8 * 1024) / 3) * 4);
    });

    it("reads Caseworking's answer no longer than that", async () => {
      wreck.request.mockReturnValue(pending({ statusCode: 200 }));
      wreck.read.mockResolvedValue(PART);

      await queryCwExplore(
        { v: 4, mode: "rows" },
        { timeLeftMs: 5000, signal: signal() },
      );

      expect(wreck.read.mock.calls[0][1].maxBytes).toBe(
        maxBytesOf({ mode: "rows" }),
      );
    });

    it("refuses a longer answer with what to do, as Caseworking's", async () => {
      wreck.request.mockReturnValue(pending({ statusCode: 200 }));
      wreck.read.mockRejectedValue(
        Boom.entityTooLarge(
          "Payload content length greater than maximum allowed",
        ),
      );

      const error = await failure(
        queryCwExplore(
          { v: 4, mode: "rows" },
          { timeLeftMs: 5000, signal: signal() },
        ),
      );

      expect(refusalOf(error)).toBe("ANSWER_TOO_LARGE");
      expect(error.service).toBe("CW");
    });
  });

  describe("a refusal of mongod's", () => {
    const refusedWith = async (detail) => {
      wreck.post.mockRejectedValue(
        httpError(400, {
          reason: "EXPLORE_QUERY_REFUSED",
          refusal: "MONGOD_ERROR",
          detail,
        }),
      );

      return failure(queryCwExplore({ v: 4 }, { timeLeftMs: 5000 }));
    };

    it("keeps the type mongod named and the column, nothing else", async () => {
      const error = await refusedWith({
        fn: "count",
        type: "string",
        column: 2,
        value: "Sentinel",
      });

      expect(refusalOf(error)).toBe("MONGOD_ERROR");
      expect(error.service).toBe("CW");
      expect(error.detail).toEqual({ fn: "count", type: "string", column: 2 });
    });

    it.each([
      [
        "a column past the columns",
        { fn: "count", type: "string", column: 20 },
        { fn: "count", type: "string", column: null },
      ],
      [
        "a column that isn't one",
        { fn: "count", type: "string", column: "1" },
        { fn: "count", type: "string", column: null },
      ],
      ["a type that is no word", { fn: "count", type: "a b", column: 1 }, null],
      [
        "an expression it doesn't know",
        { fn: "sum", type: "string", column: 1 },
        null,
      ],
    ])("reads %s as no more than it can trust", async (_, detail, kept) => {
      expect((await refusedWith(detail)).detail).toEqual(kept);
    });
  });

  describe("a documents fetch", () => {
    const asked = {
      box: "cw.cases",
      id: BSON.serialize({ _id: 1 }).toString("base64"),
      at: [],
    };
    const query = {
      v: 4,
      mode: "documents",
      documents: { whole: true, id: true, bytes: 100 },
      rows: [asked, asked],
    };
    const entry = (more) => ({ ...asked, context: null, ...more });

    it("reads documents checked by hand", async () => {
      const answer = {
        documents: [
          entry({ doc: BSON.serialize({ a: 1 }).toString("base64") }),
          entry({ gone: true }),
        ],
      };

      wreck.post.mockResolvedValue({ payload: answer });

      expect(await queryCwExplore(query, { timeLeftMs: 5000 })).toEqual(answer);
      expect(wreck.post.mock.calls[0][1].maxBytes).toBe(maxBytesOf(query));
    });

    it.each([
      [
        "a document that isn't BSON",
        [entry({ doc: "AAAA" }), entry({ gone: true })],
      ],
      [
        "more bytes than it asked for, past the first",
        [
          entry({
            doc: BSON.serialize({ a: "x".repeat(90) }).toString("base64"),
          }),
          entry({
            doc: BSON.serialize({ a: "x".repeat(90) }).toString("base64"),
          }),
        ],
      ],
      ["fewer entries than rows asked", [entry({ gone: true })]],
      [
        "an entry for a row it wasn't asked for",
        [
          entry({ gone: true }),
          entry({
            id: BSON.serialize({ _id: 2 }).toString("base64"),
            gone: true,
          }),
        ],
      ],
    ])("says Caseworking errored for %s", async (_, documents) => {
      wreck.post.mockResolvedValue({ payload: { documents } });

      const error = await failure(queryCwExplore(query, { timeLeftMs: 5000 }));

      expect(error.output.payload).toMatchObject({
        hop: "CW-BE",
        reason: "ERRORED",
      });
    });
  });
});

describe("cwRequest with maxBytes", () => {
  const pending = (res) =>
    Object.assign(Promise.resolve(res), { req: { destroy: vi.fn() } });
  const failures = {
    tooLarge: () => new Error("too large"),
    otherwise: () => new Error("other"),
  };
  const ask = (options) =>
    failure(
      cwRequest("post", "/x", "x", {
        body: {},
        failures,
        signal: new AbortController().signal,
        ...options,
      }),
    );

  beforeEach(() => {
    wreck.request.mockReturnValue(pending({ statusCode: 200 }));
    wreck.read.mockRejectedValue(Boom.entityTooLarge("too long"));
  });

  it("reads an answer over maxBytes as too large", async () => {
    expect((await ask({ maxBytes: 10 })).message).toBe("too large");
    expect(wreck.read.mock.calls[0][1].maxBytes).toBe(10);
  });

  it("reads a 413 asked no maxBytes as any other failure", async () => {
    expect((await ask({})).message).toBe("other");
  });
});
