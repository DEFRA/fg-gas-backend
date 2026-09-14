import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wreck } from "../../common/wreck.js";
import {
  describeError,
  findCwEvent,
  findCwPage,
  isCwConfigured,
  notConfiguredMessage,
  redriveCwEvent,
} from "./cw-actuators.repository.js";

const { cwBackend } = vi.hoisted(() => ({
  cwBackend: { url: undefined, token: undefined },
}));

vi.mock("../../common/config.js", () => ({ config: { cwBackend } }));
vi.mock("../../common/wreck.js", () => ({
  wreck: { get: vi.fn(), post: vi.fn() },
}));

const URL_BASE = "http://cw.test";
const TOKEN = "cw-token";

const someCounts = () => ({
  PUBLISHED: 1,
  PROCESSING: 0,
  FAILED: 2,
  RESUBMITTED: 0,
  COMPLETED: 3,
  DEAD_LETTER: 4,
});

const someGroups = () => [
  {
    error: "No handler found",
    type: "cloud.defra.local.fg-cw-backend.case.create",
    count: 4,
    firstAt: "2026-06-16T10:00:00.000Z",
    lastAt: "2026-06-16T11:00:00.000Z",
  },
];

// One box of the composite as Caseworking answers it.
const box = (overrides = {}) => ({
  events: [{ _id: "665f1c2e9a1b2c3d4e5f6a7b" }],
  pagination: {
    startCursor: "a",
    endCursor: "b",
    hasNextPage: false,
    hasPreviousPage: false,
  },
  counts: someCounts(),
  breakdown: { groups: someGroups() },
  ...overrides,
});

const composite = (overrides = {}) => ({
  payload: { inbox: box(), outbox: box(), ...overrides },
});

const aPage = (overrides = {}) => ({
  pageSize: 20,
  direction: "forward",
  ...overrides,
});

const calledUrl = () => new URL(wreck.get.mock.calls[0][0]);

const TIMEOUT_MS = 3000;

beforeEach(() => {
  cwBackend.url = URL_BASE;
  cwBackend.token = TOKEN;
  cwBackend.timeoutMs = TIMEOUT_MS;
});

describe("findCwPage", () => {
  it("calls /actuators/events with pageSize 20, direction and the bearer token", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage());

    const url = calledUrl();

    expect(url.pathname).toEqual("/actuators/events");
    expect(url.searchParams.get("pageSize")).toEqual("20");
    expect(url.searchParams.get("direction")).toEqual("forward");
    expect(wreck.get.mock.calls[0][1]).toEqual({
      json: true,
      timeout: TIMEOUT_MS,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  });

  it("asks for the direction the page was turned in", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage({ direction: "backward" }));

    expect(calledUrl().searchParams.get("direction")).toEqual("backward");
  });

  it("carries a cursor per box, taken from the composite cursor's own slices", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(
      aPage({
        slices: {
          gasInbox: "gas-slice",
          cwInbox: "eyJldmVudFRpbWUiOm51bGx9",
          cwOutbox: "eyJwdWJsaWNhdGlvbkRhdGUiOm51bGx9",
        },
      }),
    );

    const params = calledUrl().searchParams;

    expect(params.get("inboxCursor")).toEqual("eyJldmVudFRpbWUiOm51bGx9");
    expect(params.get("outboxCursor")).toEqual(
      "eyJwdWJsaWNhdGlvbkRhdGUiOm51bGx9",
    );
    expect(params.has("cursor")).toBe(false);
  });

  it("omits the cursor of a box that has no position yet", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage({ slices: { cwInbox: "abc", cwOutbox: null } }));

    expect(calledUrl().searchParams.get("inboxCursor")).toEqual("abc");
    expect(calledUrl().searchParams.has("outboxCursor")).toBe(false);
  });

  it("omits both cursors and every filter on a first, unfiltered page", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage());

    const params = calledUrl().searchParams;

    for (const name of [
      "inboxCursor",
      "outboxCursor",
      "status",
      "q",
      "error",
      "from",
      "to",
      "audit",
    ]) {
      expect(params.has(name)).toBe(false);
    }
  });

  it("passes status through verbatim", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage({ status: "DEAD_LETTER" }));

    expect(calledUrl().searchParams.get("status")).toEqual("DEAD_LETTER");
  });

  it("forwards q verbatim", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage({ q: "GLD-9B2-BWS" }));

    expect(calledUrl().searchParams.get("q")).toEqual("GLD-9B2-BWS");
  });

  it("url-encodes a q with regex metacharacters and spaces", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage({ q: "a b+c*" }));

    expect(calledUrl().searchParams.get("q")).toEqual("a b+c*");
  });

  it("never forwards a kind", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage({ kind: "audit" }));

    expect(calledUrl().searchParams.has("kind")).toBe(false);
  });

  it("keeps both cursors, the status and q together on one request", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(
      aPage({
        direction: "backward",
        slices: { cwInbox: "abc", cwOutbox: "def" },
        status: "FAILED",
        q: "evt-1",
      }),
    );

    expect(Object.fromEntries(calledUrl().searchParams)).toEqual({
      pageSize: "20",
      direction: "backward",
      inboxCursor: "abc",
      outboxCursor: "def",
      status: "FAILED",
      q: "evt-1",
    });
  });

  it("reads the whole page in ONE request", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage());

    expect(wreck.get).toHaveBeenCalledTimes(1);
  });

  it("propagates the wreck rejection unchanged", async () => {
    const error = Boom.unauthorized("nope");
    wreck.get.mockRejectedValue(error);

    await expect(findCwPage(aPage())).rejects.toBe(error);
  });
});

describe("findCwPage from and to", () => {
  it("forwards both bounds on the query string", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(
      aPage({
        from: "2026-06-16T00:00:00.000Z",
        to: "2026-06-16T23:59:59.999Z",
      }),
    );

    expect(calledUrl().searchParams.get("from")).toBe(
      "2026-06-16T00:00:00.000Z",
    );
    expect(calledUrl().searchParams.get("to")).toBe("2026-06-16T23:59:59.999Z");
  });

  it("omits a bound that was not supplied", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage({ from: "x" }));

    expect(calledUrl().searchParams.has("to")).toBe(false);
  });
});

describe("the error filter reaches Caseworking", () => {
  it("forwards `error` on the page query", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage({ error: "No handler found" }));

    expect(calledUrl().searchParams.get("error")).toBe("No handler found");
  });

  it("omits it entirely when absent, so an unfiltered call is unchanged", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage());

    expect(calledUrl().searchParams.has("error")).toBe(false);
  });
});

describe("the audit dimension reaches Caseworking", () => {
  it("forwards `audit` on the page query, so the figures match the rows", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage({ audit: "include" }));

    expect(calledUrl().searchParams.get("audit")).toBe("include");
  });

  it("omits it entirely when absent, so an unfiltered call is unchanged", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage());

    expect(calledUrl().searchParams.has("audit")).toBe(false);
  });
});

describe("findCwPage response", () => {
  it("answers with each box's rows, counts and groups", async () => {
    wreck.get.mockResolvedValue(composite());

    const page = await findCwPage(aPage());

    expect(page).toEqual({
      inbox: {
        list: {
          data: [{ _id: "665f1c2e9a1b2c3d4e5f6a7b" }],
          pagination: {
            startCursor: "a",
            endCursor: "b",
            hasNextPage: false,
            hasPreviousPage: false,
          },
        },
        facets: { counts: someCounts() },
        groups: someGroups(),
      },
      outbox: {
        list: {
          data: [{ _id: "665f1c2e9a1b2c3d4e5f6a7b" }],
          pagination: expect.any(Object),
        },
        facets: { counts: someCounts() },
        groups: someGroups(),
      },
    });
  });

  // Degradation fires on failure, not on slowness: a Caseworking that answers
  // just inside the shared client's ten-second ceiling degrades nothing and
  // stalls every render, on the surface an operator opens when things are
  // already wrong.
  it("gives the page read its own timeout, not the shared client's", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage());

    expect(wreck.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: cwBackend.timeoutMs }),
    );
    expect(cwBackend.timeoutMs).toBeLessThan(10000);
  });

  it("tolerates an envelope with no totalCount", async () => {
    wreck.get.mockResolvedValue(composite());

    expect(
      (await findCwPage(aPage())).inbox.list.pagination,
    ).not.toHaveProperty("totalCount");
  });

  it("tolerates a box that sent rows but no pagination", async () => {
    wreck.get.mockResolvedValue(
      composite({ inbox: box({ pagination: undefined }) }),
    );

    expect((await findCwPage(aPage())).inbox.list).toEqual({
      data: [{ _id: "665f1c2e9a1b2c3d4e5f6a7b" }],
      pagination: {},
    });
  });

  // The rows are mapped INSIDE the fan-out's fulfilled branch, so a body this
  // service cannot map does not reject a source - it throws past the whole
  // `Promise.allSettled` and 500s the request, taking the composite page with
  // it. A wrongly shaped body is exactly what the degradation contract is
  // for, so it is turned into that contract's own vocabulary here.
  it.each([
    ["events that are not a list at all", { events: "nope" }],
    ["events that are a truthy non-array", { events: {} }],
    ["a row with no id", { events: [{ eventId: "evt-1" }] }],
    ["a row whose id is not a string", { events: [{ _id: 12345 }] }],
    [
      "one bad row among good ones",
      {
        events: [{ _id: "665f1c2e9a1b2c3d4e5f6a7b" }, { _id: null }],
      },
    ],
  ])("reports %s as a gap rather than throwing", async (_name, events) => {
    wreck.get.mockResolvedValue(composite({ inbox: box(events) }));

    const page = await findCwPage(aPage());

    expect(page.inbox.list).toBeNull();
    // The other box is untouched: one malformed section is not a failed read.
    expect(page.outbox.list.data).toHaveLength(1);
  });

  // A section Caseworking could not read is a gap, not an empty answer.
  it("leaves a section Caseworking could not read null rather than empty", async () => {
    wreck.get.mockResolvedValue(composite({ inbox: {} }));

    expect((await findCwPage(aPage())).inbox).toEqual({
      list: null,
      facets: null,
      groups: null,
    });
  });

  it("nulls only the section that is missing, keeping the box's others", async () => {
    wreck.get.mockResolvedValue(
      composite({ inbox: box({ counts: undefined }) }),
    );

    const { inbox } = await findCwPage(aPage());

    expect(inbox.facets).toBeNull();
    expect(inbox.list.data).toHaveLength(1);
    expect(inbox.groups).toEqual(someGroups());
  });

  it("nulls one box without touching the other", async () => {
    wreck.get.mockResolvedValue(composite({ outbox: {} }));

    const page = await findCwPage(aPage());

    expect(page.outbox).toEqual({ list: null, facets: null, groups: null });
    expect(page.inbox.facets).toEqual({ counts: someCounts() });
  });

  it("nulls every section of both boxes when there is no payload at all", async () => {
    wreck.get.mockResolvedValue({ payload: null });

    expect(await findCwPage(aPage())).toEqual({
      inbox: { list: null, facets: null, groups: null },
      outbox: { list: null, facets: null, groups: null },
    });
  });

  it("nulls every section of both boxes when the payload is empty", async () => {
    wreck.get.mockResolvedValue({ payload: {} });

    expect(await findCwPage(aPage())).toEqual({
      inbox: { list: null, facets: null, groups: null },
      outbox: { list: null, facets: null, groups: null },
    });
  });

  it("keeps an empty dead-letter breakdown as no groups rather than as a gap", async () => {
    wreck.get.mockResolvedValue(
      composite({ inbox: box({ breakdown: { groups: [] } }) }),
    );

    expect((await findCwPage(aPage())).inbox.groups).toEqual([]);
  });

  it("ignores a byKind block Caseworking still sends", async () => {
    wreck.get.mockResolvedValue(
      composite({ inbox: box({ byKind: { domain: 5, audit: 1 } }) }),
    );

    expect((await findCwPage(aPage())).inbox.facets).toEqual({
      counts: someCounts(),
    });
  });

  it("does not catch, so the use case can turn it into a sourceError", async () => {
    wreck.get.mockRejectedValue(Boom.badGateway("down"));

    await expect(findCwPage(aPage())).rejects.toThrow();
  });
});

describe("isCwConfigured", () => {
  it("is true when both the url and the token are set", () => {
    expect(isCwConfigured()).toBe(true);
  });

  it("is false when the url is unset", () => {
    cwBackend.url = undefined;

    expect(isCwConfigured()).toBe(false);
  });

  it("is false when the token is unset", () => {
    cwBackend.token = undefined;

    expect(isCwConfigured()).toBe(false);
  });
});

describe("notConfiguredMessage", () => {
  it("is the fixed one-liner the use case reports for an unset CW backend", () => {
    expect(notConfiguredMessage()).toEqual("not configured");
  });
});

describe("describeError", () => {
  it("maps a 504 gateway timeout to timeout", () => {
    expect(
      describeError(Boom.gatewayTimeout("Client request timeout")),
    ).toEqual("timeout");
  });

  it("maps a 408 client timeout to timeout", () => {
    expect(describeError(Boom.clientTimeout())).toEqual("timeout");
  });

  it("maps a Boom 401 to HTTP 401", () => {
    expect(describeError(Boom.unauthorized("nope"))).toEqual("HTTP 401");
  });

  it("maps a transport error arriving as a Boom 502 to HTTP 502", () => {
    expect(describeError(Boom.badGateway("Client request error"))).toEqual(
      "HTTP 502",
    );
  });

  it("maps a plain Error to read failed", () => {
    expect(describeError(new Error("boom"))).toEqual("read failed");
  });

  it("maps an undefined error to read failed", () => {
    expect(describeError(undefined)).toEqual("read failed");
  });

  it("never returns anything drawn from error.data.payload", () => {
    const error = Boom.unauthorized("Unauthorized");
    error.data = {
      payload: { message: "caseworker jane.doe@defra.gov.uk token expired" },
    };

    const described = describeError(error);

    expect(described).toEqual("HTTP 401");
    expect(described).not.toContain("jane.doe");
    expect(described).not.toContain("token");
  });
});

// ---------------------------------------------------------------------------
// Single-event reads and redrives. Unlike the list these have no partial mode,
// so a Caseworking failure is translated into an HTTP status here.
// ---------------------------------------------------------------------------
const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const httpError = (statusCode, body) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: {
      payload:
        body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
    },
  });

describe("findCwEvent", () => {
  it("GETs /actuators/events/{box}/{id} with the bearer token", async () => {
    wreck.get.mockResolvedValue({ payload: { _id: ID, event: { id: "e" } } });

    await findCwEvent("inbox", ID);

    expect(new URL(wreck.get.mock.calls[0][0]).pathname).toBe(
      `/actuators/events/inbox/${ID}`,
    );
    expect(wreck.get.mock.calls[0][1]).toEqual({
      json: true,
      timeout: TIMEOUT_MS,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  });

  it("returns the caseworking document as-is, payload included", async () => {
    const doc = { _id: ID, maxAttempts: 7, event: { id: "e", data: { a: 1 } } };
    wreck.get.mockResolvedValue({ payload: doc });

    expect(await findCwEvent("outbox", ID)).toBe(doc);
  });

  it("turns a caseworking 404 into a 404", async () => {
    wreck.get.mockRejectedValue(httpError(404, { message: "SECRET-BODY" }));

    const error = await findCwEvent("inbox", ID).catch((e) => e);

    expect(error.output.statusCode).toBe(404);
    expect(error.message).not.toContain("SECRET-BODY");
  });

  it("turns any other caseworking failure into a 502", async () => {
    wreck.get.mockRejectedValue(httpError(500, { message: "SECRET-BODY" }));

    const error = await findCwEvent("inbox", ID).catch((e) => e);

    expect(error.output.statusCode).toBe(502);
    expect(error.message).toContain("HTTP 500");
    expect(error.message).not.toContain("SECRET-BODY");
  });

  it("turns a transport failure into a 502", async () => {
    wreck.get.mockRejectedValue(new Error("socket hang up"));

    const error = await findCwEvent("inbox", ID).catch((e) => e);

    expect(error.output.statusCode).toBe(502);
    expect(error.message).toContain("read failed");
  });

  it("502s without calling caseworking at all when it is not configured", async () => {
    cwBackend.url = undefined;

    const error = await findCwEvent("inbox", ID).catch((e) => e);

    expect(error.output.statusCode).toBe(502);
    expect(error.message).toContain("not configured");
    expect(wreck.get).not.toHaveBeenCalled();
  });
});

describe("redriveCwEvent", () => {
  it("POSTs /actuators/events/{box}/{id}/redrive with the bearer token", async () => {
    wreck.post.mockResolvedValue({ payload: { _id: ID } });

    await redriveCwEvent("outbox", ID);

    expect(new URL(wreck.post.mock.calls[0][0]).pathname).toBe(
      `/actuators/events/outbox/${ID}/redrive`,
    );
    expect(wreck.post.mock.calls[0][1]).toEqual({
      json: true,
      timeout: TIMEOUT_MS,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  });

  it("returns the caseworking row", async () => {
    const row = { _id: ID, status: "RESUBMITTED" };
    wreck.post.mockResolvedValue({ payload: row });

    expect(await redriveCwEvent("inbox", ID)).toBe(row);
  });

  it("turns a caseworking 409 into a 409 carrying the current status", async () => {
    wreck.post.mockRejectedValue(
      httpError(409, { statusCode: 409, status: "COMPLETED" }),
    );

    const error = await redriveCwEvent("inbox", ID).catch((e) => e);

    expect(error.output.statusCode).toBe(409);
    expect(error.output.payload.status).toBe("COMPLETED");
  });

  it("ignores a status that is not one of the six known ones", async () => {
    wreck.post.mockRejectedValue(httpError(409, { status: "SECRET" }));

    const error = await redriveCwEvent("inbox", ID).catch((e) => e);

    expect(error.output.statusCode).toBe(409);
    expect(error.output.payload.status).toBeUndefined();
    expect(error.message).not.toContain("SECRET");
  });

  it("copes with a 409 whose body is not JSON", async () => {
    wreck.post.mockRejectedValue(
      Object.assign(new Error("conflict"), {
        output: { statusCode: 409 },
        data: { payload: Buffer.from("<html>nope</html>") },
      }),
    );

    const error = await redriveCwEvent("inbox", ID).catch((e) => e);

    expect(error.output.statusCode).toBe(409);
    expect(error.output.payload.status).toBeUndefined();
  });

  it("reads the status from an already-parsed body too", async () => {
    wreck.post.mockRejectedValue(
      Object.assign(new Error("conflict"), {
        output: { statusCode: 409 },
        data: { payload: { status: "PROCESSING" } },
      }),
    );

    const error = await redriveCwEvent("inbox", ID).catch((e) => e);

    expect(error.output.payload.status).toBe("PROCESSING");
  });

  it("turns a caseworking 404 into a 404", async () => {
    wreck.post.mockRejectedValue(httpError(404, { message: "nope" }));

    await expect(redriveCwEvent("inbox", ID)).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });

  it("turns any other caseworking failure into a 502", async () => {
    wreck.post.mockRejectedValue(httpError(503, { message: "SECRET-BODY" }));

    const error = await redriveCwEvent("inbox", ID).catch((e) => e);

    expect(error.output.statusCode).toBe(502);
    expect(error.message).not.toContain("SECRET-BODY");
  });

  it("502s without calling caseworking when it is not configured", async () => {
    cwBackend.token = undefined;

    await expect(redriveCwEvent("inbox", ID)).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
    expect(wreck.post).not.toHaveBeenCalled();
  });
});

const postedUrl = () => new URL(wreck.post.mock.calls[0][0]);

describe("redriveCwEvent actor", () => {
  it("sends `by` as a query parameter on a redrive", async () => {
    wreck.post.mockResolvedValue({ payload: {} });

    await redriveCwEvent("inbox", ID, { by: "donatas" });

    expect(postedUrl().pathname).toBe(`/actuators/events/inbox/${ID}/redrive`);
    expect(postedUrl().searchParams.get("by")).toBe("donatas");
  });

  it("omits `by` entirely when nobody named themselves", async () => {
    wreck.post.mockResolvedValue({ payload: {} });

    await redriveCwEvent("inbox", ID);

    expect(postedUrl().search).toBe("");
    expect(wreck.post.mock.calls[0][1]).toEqual({
      json: true,
      timeout: TIMEOUT_MS,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  });

  it("percent-encodes an actor with awkward characters", async () => {
    wreck.post.mockResolvedValue({ payload: {} });

    await redriveCwEvent("inbox", ID, { by: "a b&c" });

    expect(postedUrl().searchParams.get("by")).toBe("a b&c");
  });
});
