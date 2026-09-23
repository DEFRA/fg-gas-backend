import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wreck } from "../../common/wreck.js";
import {
  describeError,
  editCwPayload,
  findCwEvent,
  findCwPage,
  isCwConfigured,
  purgeCwEvent,
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

const box = (overrides = {}) => ({
  events: [{ _id: "665f1c2e9a1b2c3d4e5f6a7b" }],
  pagination: { endCursor: "b", hasNextPage: false },
  counts: someCounts(),
  breakdown: { groups: someGroups() },
  ...overrides,
});

const composite = (overrides = {}) => ({
  payload: { inbox: box(), outbox: box(), ...overrides },
});

const aPage = (overrides = {}) => ({
  pageSize: 20,
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
  it("calls /actuators/events with pageSize 20 and the bearer token", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage());

    const url = calledUrl();

    expect(url.pathname).toEqual("/actuators/events");
    expect(url.searchParams.get("pageSize")).toEqual("20");
    expect(wreck.get.mock.calls[0][1]).toEqual({
      json: true,
      timeout: TIMEOUT_MS,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
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
        slices: { cwInbox: "abc", cwOutbox: "def" },
        status: "FAILED",
        q: "evt-1",
      }),
    );

    expect(Object.fromEntries(calledUrl().searchParams)).toEqual({
      pageSize: "20",
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

describe("findCwPage sections", () => {
  it("asks for exactly the sections the page draws, as a comma list", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage({ sections: ["list", "counts"] }));

    expect(calledUrl().searchParams.get("sections")).toBe("list,counts");
  });

  it("omits it when no sections are named, leaving Caseworking's default of all three", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage());

    expect(calledUrl().searchParams.has("sections")).toBe(false);
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
          pagination: { endCursor: "b", hasNextPage: false },
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

  it("gives the page read its own timeout, not the shared client's", async () => {
    wreck.get.mockResolvedValue(composite());

    await findCwPage(aPage());

    expect(wreck.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: cwBackend.timeoutMs }),
    );
    expect(cwBackend.timeoutMs).toBeLessThan(10000);
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
    expect(page.outbox.list.data).toHaveLength(1);
  });

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

  it("names every status a redrive would have taken in its 409", async () => {
    wreck.post.mockRejectedValue(
      httpError(409, { statusCode: 409, status: "COMPLETED" }),
    );

    const error = await redriveCwEvent("inbox", ID).catch((e) => e);

    expect(error.message).toBe(
      `CW-BE inbox event "${ID}" is COMPLETED, not redrivable (DEAD_LETTER or PURGED)`,
    );
  });

  it("sends no body at all, as the caseworking redrive route takes none", async () => {
    wreck.post.mockResolvedValue({ payload: {} });

    await redriveCwEvent("inbox", ID);

    expect(wreck.post.mock.calls[0][1]).not.toHaveProperty("payload");
  });

  it("ignores a status that is not one of the known ones", async () => {
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

  // The redrive may have committed after the client gave up, so it is not a refusal.
  it("turns a caseworking timeout into a 504 rather than a failure", async () => {
    wreck.post.mockRejectedValue(Boom.gatewayTimeout("Client request timeout"));

    const error = await redriveCwEvent("inbox", ID).catch((e) => e);

    expect(error.output.statusCode).toBe(504);
    expect(error.message).toBe(
      'CW-BE did not answer in time for inbox event "' + ID + '"',
    );
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

describe("purgeCwEvent", () => {
  const aPurge = (overrides = {}) => ({
    by: "donatas",
    reasonCode: "BROKEN_PAYLOAD",
    ...overrides,
  });

  it("POSTs /actuators/events/{box}/{id}/purge with the bearer token", async () => {
    wreck.post.mockResolvedValue({ payload: undefined });

    await purgeCwEvent("outbox", ID, aPurge());

    expect(new URL(wreck.post.mock.calls[0][0]).pathname).toBe(
      `/actuators/events/outbox/${ID}/purge`,
    );
    expect(wreck.post.mock.calls[0][1]).toMatchObject({
      json: true,
      timeout: TIMEOUT_MS,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  });

  it("sends the reason and the note as the request body", async () => {
    wreck.post.mockResolvedValue({ payload: undefined });

    await purgeCwEvent("inbox", ID, aPurge({ note: "lost its clientRef" }));

    expect(wreck.post.mock.calls[0][1].payload).toEqual({
      reasonCode: "BROKEN_PAYLOAD",
      note: "lost its clientRef",
    });
  });

  it("leaves the note key out entirely when there is none", async () => {
    wreck.post.mockResolvedValue({ payload: undefined });

    await purgeCwEvent("inbox", ID, aPurge({ note: null }));

    expect(wreck.post.mock.calls[0][1].payload).toEqual({
      reasonCode: "BROKEN_PAYLOAD",
    });
    expect(wreck.post.mock.calls[0][1].payload).not.toHaveProperty("note");
  });

  it("sends `by` as a query parameter, as a redrive does", async () => {
    wreck.post.mockResolvedValue({ payload: undefined });

    await purgeCwEvent("inbox", ID, aPurge({ by: "donatas" }));

    expect(new URL(wreck.post.mock.calls[0][0]).searchParams.get("by")).toBe(
      "donatas",
    );
  });

  // Caseworking refuses an unattributed purge, so `by` is never left off.
  it("percent-encodes an operator with awkward characters", async () => {
    wreck.post.mockResolvedValue({ payload: undefined });

    await purgeCwEvent("inbox", ID, aPurge({ by: "a b&c" }));

    expect(new URL(wreck.post.mock.calls[0][0]).searchParams.get("by")).toBe(
      "a b&c",
    );
  });

  it("turns a caseworking 404 into a 404", async () => {
    wreck.post.mockRejectedValue(httpError(404, { message: "nope" }));

    await expect(purgeCwEvent("inbox", ID, aPurge())).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });

  it("turns a caseworking 409 into a 409 carrying the current status", async () => {
    wreck.post.mockRejectedValue(
      httpError(409, { statusCode: 409, status: "PURGED" }),
    );

    const error = await purgeCwEvent("inbox", ID, aPurge()).catch((e) => e);

    expect(error.output.statusCode).toBe(409);
    expect(error.output.payload.status).toBe("PURGED");
    expect(error.message).toBe(
      `CW-BE inbox event "${ID}" is PURGED, not DEAD_LETTER`,
    );
  });

  it("ignores a status that is not one it knows", async () => {
    wreck.post.mockRejectedValue(httpError(409, { status: "SECRET" }));

    const error = await purgeCwEvent("inbox", ID, aPurge()).catch((e) => e);

    expect(error.output.statusCode).toBe(409);
    expect(error.output.payload.status).toBeUndefined();
    expect(error.message).not.toContain("SECRET");
  });

  // Caseworking may still commit after GAS gives up, so this is not a refusal.
  it("turns a caseworking timeout into a 504 rather than a failure", async () => {
    wreck.post.mockRejectedValue(Boom.gatewayTimeout("Client request timeout"));

    const error = await purgeCwEvent("inbox", ID, aPurge()).catch((e) => e);

    expect(error.output.statusCode).toBe(504);
    expect(error.message).toBe(
      `CW-BE did not answer in time for inbox event "${ID}"`,
    );
  });

  it("turns any other caseworking failure into a 502", async () => {
    wreck.post.mockRejectedValue(httpError(503, { message: "SECRET-BODY" }));

    const error = await purgeCwEvent("inbox", ID, aPurge()).catch((e) => e);

    expect(error.output.statusCode).toBe(502);
    expect(error.message).not.toContain("SECRET-BODY");
  });

  it("502s without calling caseworking when it is not configured", async () => {
    cwBackend.token = undefined;

    await expect(purgeCwEvent("inbox", ID, aPurge())).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
    expect(wreck.post).not.toHaveBeenCalled();
  });
});

describe("editCwPayload", () => {
  const anEdit = (overrides = {}) => ({
    by: "donatas",
    payload: { id: "evt-1", data: { sheetId: "S1" } },
    note: "sheetId was sent as a number",
    revision: 0,
    ...overrides,
  });

  const edited = {
    payloadRevision: 1,
    changedPaths: ["/data/sheetId"],
    changedPathsTruncated: false,
  };

  it("POSTs /actuators/events/{box}/{id}/payload with the bearer token", async () => {
    wreck.post.mockResolvedValue({ payload: edited });

    await editCwPayload("outbox", ID, anEdit());

    expect(new URL(wreck.post.mock.calls[0][0]).pathname).toBe(
      `/actuators/events/outbox/${ID}/payload`,
    );
    expect(wreck.post.mock.calls[0][1]).toMatchObject({
      json: true,
      timeout: TIMEOUT_MS,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  });

  it("sends the payload, the note and the revision as the body", async () => {
    wreck.post.mockResolvedValue({ payload: edited });

    await editCwPayload("inbox", ID, anEdit({ revision: 3 }));

    expect(wreck.post.mock.calls[0][1].payload).toEqual({
      payload: { id: "evt-1", data: { sheetId: "S1" } },
      note: "sheetId was sent as a number",
      revision: 3,
    });
  });

  it("names the operator on the query string, percent-encoded", async () => {
    wreck.post.mockResolvedValue({ payload: edited });

    await editCwPayload("inbox", ID, anEdit({ by: "a b&c" }));

    expect(new URL(wreck.post.mock.calls[0][0]).searchParams.get("by")).toBe(
      "a b&c",
    );
  });

  it("returns what caseworking changed", async () => {
    wreck.post.mockResolvedValue({ payload: edited });

    expect(await editCwPayload("inbox", ID, anEdit())).toEqual(edited);
  });

  it("turns a caseworking 404 into a 404", async () => {
    wreck.post.mockRejectedValue(httpError(404, { message: "nope" }));

    await expect(editCwPayload("inbox", ID, anEdit())).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });

  it("turns a caseworking 409 into a 409 naming what an edit needs", async () => {
    wreck.post.mockRejectedValue(
      httpError(409, { statusCode: 409, status: "COMPLETED" }),
    );

    const error = await editCwPayload("inbox", ID, anEdit()).catch((e) => e);

    expect(error.output.statusCode).toBe(409);
    expect(error.output.payload.status).toBe("COMPLETED");
    expect(error.message).toBe(
      `CW-BE inbox event "${ID}" is COMPLETED, not editable (DEAD_LETTER or PURGED)`,
    );
  });

  // Not "could not be reached": the admin tells the operator to reload.
  it("passes a caseworking 412 through as a 412", async () => {
    wreck.post.mockRejectedValue(
      httpError(412, { statusCode: 412, message: "SECRET-BODY" }),
    );

    const error = await editCwPayload("inbox", ID, anEdit()).catch((e) => e);

    expect(error.output.statusCode).toBe(412);
    expect(error.message).not.toContain("SECRET-BODY");
  });

  it.each(["TOO_LARGE", "UNCHANGED", "NOT_AN_OBJECT", "DOLLAR_KEY"])(
    "passes a caseworking 422 through with its %s reason",
    async (reason) => {
      wreck.post.mockRejectedValue(
        httpError(422, { statusCode: 422, reason, message: "SECRET-BODY" }),
      );

      const error = await editCwPayload("inbox", ID, anEdit()).catch((e) => e);

      expect(error.output.statusCode).toBe(422);
      expect(error.output.payload.reason).toBe(reason);
      expect(error.message).not.toContain("SECRET-BODY");
    },
  );

  it("drops a 422 reason it does not know", async () => {
    wreck.post.mockRejectedValue(httpError(422, { reason: "SECRET-REASON" }));

    const error = await editCwPayload("inbox", ID, anEdit()).catch((e) => e);

    expect(error.output.statusCode).toBe(422);
    expect(error.output.payload.reason).toBeNull();
    expect(JSON.stringify(error.output.payload)).not.toContain("SECRET");
  });

  it("turns a caseworking timeout into a 504", async () => {
    wreck.post.mockRejectedValue(Boom.gatewayTimeout("Client request timeout"));

    const error = await editCwPayload("inbox", ID, anEdit()).catch((e) => e);

    expect(error.output.statusCode).toBe(504);
  });

  it("turns any other caseworking failure into a 502", async () => {
    wreck.post.mockRejectedValue(httpError(500, { message: "SECRET-BODY" }));

    const error = await editCwPayload("inbox", ID, anEdit()).catch((e) => e);

    expect(error.output.statusCode).toBe(502);
    expect(error.message).not.toContain("SECRET-BODY");
  });
});
