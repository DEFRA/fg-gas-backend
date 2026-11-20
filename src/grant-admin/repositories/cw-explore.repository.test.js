import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  accumulate,
  partialValue,
  sentPartial,
} from "../../common/explore/evaluate.js";
import { mergeGroups } from "../../common/explore/merge.js";
import { refusalOf } from "../../common/explore/refusal.js";
import { wreck } from "../../common/wreck.js";
import {
  findCwExploreSources,
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
      partialValue("sum", mergeGroups(lists)[0].aggs["sum(x)"]);

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
});
