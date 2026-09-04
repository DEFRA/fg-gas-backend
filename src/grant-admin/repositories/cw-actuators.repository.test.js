import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wreck } from "../../common/wreck.js";
import {
  breakdownCwInbox,
  breakdownCwOutbox,
  countCwInbox,
  countCwOutbox,
  describeError,
  findCwDeadLetterIds,
  findCwEvent,
  findCwInboxPage,
  findCwOutboxPage,
  isCwConfigured,
  notConfiguredMessage,
  parkCwEvent,
  redriveCwEvent,
  unparkCwEvent,
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

const envelope = (overrides = {}) => ({
  payload: {
    data: [{ _id: "665f1c2e9a1b2c3d4e5f6a7b" }],
    pagination: {
      startCursor: "a",
      endCursor: "b",
      hasNextPage: false,
      hasPreviousPage: false,
    },
    ...overrides,
  },
});

const calledUrl = () => new URL(wreck.get.mock.calls[0][0]);

beforeEach(() => {
  cwBackend.url = URL_BASE;
  cwBackend.token = TOKEN;
});

describe("findCwInboxPage / findCwOutboxPage", () => {
  it("calls /actuators/inbox with pageSize 20, direction and the bearer token", async () => {
    wreck.get.mockResolvedValue(envelope());

    await findCwInboxPage({ direction: "forward", pageSize: 20 });

    const url = calledUrl();

    expect(url.pathname).toEqual("/actuators/inbox");
    expect(url.searchParams.get("pageSize")).toEqual("20");
    expect(url.searchParams.get("direction")).toEqual("forward");
    expect(wreck.get.mock.calls[0][1]).toEqual({
      json: true,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  });

  it("calls /actuators/outbox for the outbox source", async () => {
    wreck.get.mockResolvedValue(envelope());

    await findCwOutboxPage({ direction: "backward", pageSize: 20 });

    expect(calledUrl().pathname).toEqual("/actuators/outbox");
    expect(calledUrl().searchParams.get("direction")).toEqual("backward");
  });

  it("omits cursor and status from the query string when not supplied", async () => {
    wreck.get.mockResolvedValue(envelope());

    await findCwInboxPage({ direction: "forward", pageSize: 20 });

    expect(calledUrl().searchParams.has("cursor")).toBe(false);
    expect(calledUrl().searchParams.has("status")).toBe(false);
  });

  it("passes cursor and status through verbatim", async () => {
    wreck.get.mockResolvedValue(envelope());

    await findCwInboxPage({
      cursor: "eyJldmVudFRpbWUiOm51bGx9",
      status: "DEAD_LETTER",
      direction: "forward",
      pageSize: 20,
    });

    expect(calledUrl().searchParams.get("cursor")).toEqual(
      "eyJldmVudFRpbWUiOm51bGx9",
    );
    expect(calledUrl().searchParams.get("status")).toEqual("DEAD_LETTER");
  });

  it("returns data and pagination from the response envelope", async () => {
    wreck.get.mockResolvedValue(envelope());

    const page = await findCwInboxPage({ direction: "forward", pageSize: 20 });

    expect(page.data).toEqual([{ _id: "665f1c2e9a1b2c3d4e5f6a7b" }]);
    expect(page.pagination.hasNextPage).toBe(false);
  });

  it("returns empty data when the envelope has none", async () => {
    wreck.get.mockResolvedValue({ payload: {} });

    const page = await findCwInboxPage({ direction: "forward", pageSize: 20 });

    expect(page).toEqual({ data: [], pagination: {} });
  });

  it("returns empty data when there is no payload at all", async () => {
    wreck.get.mockResolvedValue({ payload: null });

    const page = await findCwInboxPage({ direction: "forward", pageSize: 20 });

    expect(page).toEqual({ data: [], pagination: {} });
  });

  it("tolerates an envelope with no totalCount", async () => {
    wreck.get.mockResolvedValue(envelope());

    const page = await findCwOutboxPage({ direction: "forward", pageSize: 20 });

    expect(page.pagination).not.toHaveProperty("totalCount");
  });

  it("propagates the wreck rejection unchanged", async () => {
    const error = Boom.unauthorized("nope");
    wreck.get.mockRejectedValue(error);

    await expect(
      findCwInboxPage({ direction: "forward", pageSize: 20 }),
    ).rejects.toBe(error);
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

describe("findCwInboxPage / findCwOutboxPage q", () => {
  beforeEach(() => {
    cwBackend.url = URL_BASE;
    cwBackend.token = TOKEN;
    wreck.get.mockResolvedValue(envelope());
  });

  it("forwards q verbatim", async () => {
    await findCwInboxPage({
      direction: "forward",
      pageSize: 20,
      q: "GLD-9B2-BWS",
    });

    expect(calledUrl().searchParams.get("q")).toEqual("GLD-9B2-BWS");
  });

  it("omits q when it is not supplied", async () => {
    await findCwOutboxPage({ direction: "forward", pageSize: 20 });

    expect(calledUrl().searchParams.has("q")).toBe(false);
  });

  // The TYPE filter is gone: a stray `kind` is never forwarded to Caseworking,
  // which would 400 on it now anyway.
  it("never forwards a kind", async () => {
    await findCwInboxPage({
      direction: "forward",
      pageSize: 20,
      kind: "audit",
    });

    expect(calledUrl().searchParams.has("kind")).toBe(false);
  });

  it("url-encodes a q with regex metacharacters and spaces", async () => {
    await findCwInboxPage({
      direction: "forward",
      pageSize: 20,
      q: "a b+c*",
    });

    expect(calledUrl().searchParams.get("q")).toEqual("a b+c*");
  });

  it("keeps cursor, status and q together on one request", async () => {
    await findCwOutboxPage({
      cursor: "abc",
      status: "FAILED",
      q: "evt-1",
      direction: "backward",
      pageSize: 20,
    });

    const params = calledUrl().searchParams;

    expect(Object.fromEntries(params)).toEqual({
      pageSize: "20",
      direction: "backward",
      cursor: "abc",
      status: "FAILED",
      q: "evt-1",
    });
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
  it("GETs /actuators/{box}/{id} with the bearer token", async () => {
    wreck.get.mockResolvedValue({ payload: { _id: ID, event: { id: "e" } } });

    await findCwEvent("inbox", ID);

    expect(new URL(wreck.get.mock.calls[0][0]).pathname).toBe(
      `/actuators/inbox/${ID}`,
    );
    expect(wreck.get.mock.calls[0][1]).toEqual({
      json: true,
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
  it("POSTs /actuators/{box}/{id}/redrive with the bearer token", async () => {
    wreck.post.mockResolvedValue({ payload: { _id: ID } });

    await redriveCwEvent("outbox", ID);

    expect(new URL(wreck.post.mock.calls[0][0]).pathname).toBe(
      `/actuators/outbox/${ID}/redrive`,
    );
    expect(wreck.post.mock.calls[0][1]).toEqual({
      json: true,
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

describe("findCwInboxPage from and to", () => {
  it("forwards both bounds on the query string", async () => {
    wreck.get.mockResolvedValue(envelope());

    await findCwInboxPage({
      direction: "forward",
      pageSize: 20,
      from: "2026-06-16T00:00:00.000Z",
      to: "2026-06-16T23:59:59.999Z",
    });

    expect(calledUrl().searchParams.get("from")).toBe(
      "2026-06-16T00:00:00.000Z",
    );
    expect(calledUrl().searchParams.get("to")).toBe("2026-06-16T23:59:59.999Z");
  });

  it("omits a bound that was not supplied", async () => {
    wreck.get.mockResolvedValue(envelope());

    await findCwInboxPage({ direction: "forward", pageSize: 20, from: "x" });

    expect(calledUrl().searchParams.has("to")).toBe(false);
  });
});

describe("countCwInbox / countCwOutbox", () => {
  const counts = () => ({
    PUBLISHED: 1,
    PROCESSING: 0,
    FAILED: 2,
    RESUBMITTED: 0,
    COMPLETED: 3,
    DEAD_LETTER: 4,
  });

  const answer = (overrides = {}) => ({
    payload: { counts: counts(), ...overrides },
  });

  it("calls /actuators/inbox/counts with the bearer token", async () => {
    wreck.get.mockResolvedValue(answer());

    const result = await countCwInbox({});

    expect(calledUrl().pathname).toBe("/actuators/inbox/counts");
    expect(wreck.get.mock.calls[0][1]).toEqual({
      json: true,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(result).toEqual({ counts: counts() });
  });

  it("reads the box in ONE call", async () => {
    wreck.get.mockResolvedValue(answer());

    await countCwInbox({});

    expect(wreck.get).toHaveBeenCalledTimes(1);
  });

  it("calls /actuators/outbox/counts for the outbox source", async () => {
    wreck.get.mockResolvedValue(answer());

    await countCwOutbox({});

    expect(calledUrl().pathname).toBe("/actuators/outbox/counts");
  });

  it("forwards q, error, from and to and nothing else", async () => {
    wreck.get.mockResolvedValue(answer());

    await countCwInbox({
      q: "GLD-9B2",
      kind: "audit",
      error: "boom",
      from: "2026-06-16T00:00:00.000Z",
      to: "2026-06-16T23:59:59.999Z",
      status: "FAILED",
      cursor: "abc",
      pageSize: 20,
    });

    const params = calledUrl().searchParams;

    expect([...params.keys()].sort()).toEqual(["error", "from", "q", "to"]);
    expect(params.get("q")).toBe("GLD-9B2");
  });

  it("sends no query string at all when nothing is filtered", async () => {
    wreck.get.mockResolvedValue(answer());

    await countCwInbox({});

    expect(calledUrl().search).toBe("");
  });

  it("treats an answer with no counts as no counts", async () => {
    wreck.get.mockResolvedValue({ payload: {} });

    expect(await countCwInbox({})).toEqual({ counts: {} });
  });

  // The TYPE facet is gone: a `byKind` block from an older Caseworking is
  // simply dropped rather than carried into the merge.
  it("ignores a byKind block Caseworking still sends", async () => {
    wreck.get.mockResolvedValue(answer({ byKind: { domain: 5, audit: 1 } }));

    expect(await countCwInbox({})).toEqual({ counts: counts() });
  });

  it("does not catch, so the use case can turn it into a sourceError", async () => {
    wreck.get.mockRejectedValue(Boom.badGateway("down"));

    await expect(countCwInbox({})).rejects.toThrow();
  });
});

const postedUrl = () => new URL(wreck.post.mock.calls[0][0]);

const page = (data, hasNextPage = false) => ({
  payload: {
    data,
    pagination: {
      startCursor: "a",
      endCursor: "cursor-1",
      hasNextPage,
      hasPreviousPage: false,
    },
  },
});

describe("the error filter reaches Caseworking", () => {
  it("forwards `error` on the list query", async () => {
    wreck.get.mockResolvedValue(envelope());

    await findCwInboxPage({
      direction: "forward",
      pageSize: 20,
      error: "No handler found",
    });

    expect(calledUrl().searchParams.get("error")).toBe("No handler found");
  });

  it("forwards `error` on the counts query", async () => {
    wreck.get.mockResolvedValue({ payload: { counts: {} } });

    await countCwInbox({ error: "No handler found" });

    expect(calledUrl().searchParams.get("error")).toBe("No handler found");
  });

  it("omits it entirely when absent, so an unfiltered call is unchanged", async () => {
    wreck.get.mockResolvedValue(envelope());

    await findCwInboxPage({ direction: "forward", pageSize: 20 });

    expect(calledUrl().searchParams.has("error")).toBe(false);
  });
});

describe("breakdownCwInbox / breakdownCwOutbox", () => {
  it("calls the box's breakdown path with the bearer token", async () => {
    wreck.get.mockResolvedValue({ payload: { groups: [] } });

    await breakdownCwInbox({});

    expect(calledUrl().pathname).toBe("/actuators/inbox/breakdown");
    expect(wreck.get.mock.calls[0][1]).toEqual({
      json: true,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  });

  it("calls the outbox path for the outbox source", async () => {
    wreck.get.mockResolvedValue({ payload: { groups: [] } });

    await breakdownCwOutbox({});

    expect(calledUrl().pathname).toBe("/actuators/outbox/breakdown");
  });

  it("forwards the counts filter", async () => {
    wreck.get.mockResolvedValue({ payload: { groups: [] } });

    await breakdownCwInbox({
      q: "GLD-9B2",
      kind: "domain",
      from: "a",
      to: "b",
    });

    const url = calledUrl();

    expect(url.searchParams.get("q")).toBe("GLD-9B2");
    expect(url.searchParams.has("kind")).toBe(false);
    expect(url.searchParams.get("from")).toBe("a");
    expect(url.searchParams.get("to")).toBe("b");
  });

  it("never forwards `error` - filtering a breakdown by one message is meaningless", async () => {
    wreck.get.mockResolvedValue({ payload: { groups: [] } });

    await breakdownCwInbox({ error: "boom" });

    expect(calledUrl().searchParams.has("error")).toBe(false);
  });

  it("answers with the groups", async () => {
    wreck.get.mockResolvedValue({
      payload: { groups: [{ error: "boom", type: "t", count: 1 }] },
    });

    expect(await breakdownCwInbox({})).toEqual([
      { error: "boom", type: "t", count: 1 },
    ]);
  });

  it("treats an answer without groups as no groups rather than as a failure", async () => {
    wreck.get.mockResolvedValue({ payload: {} });

    expect(await breakdownCwInbox({})).toEqual([]);
  });

  it("does not catch - the use case turns a rejection into a sourceError", async () => {
    wreck.get.mockRejectedValue(Boom.badGateway("down"));

    await expect(breakdownCwInbox({})).rejects.toThrow();
  });
});

describe("findCwDeadLetterIds", () => {
  it("walks the list endpoint with status=DEAD_LETTER and collects ids", async () => {
    wreck.get.mockResolvedValue(page([{ _id: "a" }, { _id: "b" }]));

    expect(await findCwDeadLetterIds("inbox", {}, 500)).toEqual(["a", "b"]);
    expect(calledUrl().searchParams.get("status")).toBe("DEAD_LETTER");
  });

  it("forwards the rest of the filter", async () => {
    wreck.get.mockResolvedValue(page([]));

    await findCwDeadLetterIds("inbox", { q: "GLD-9B2", error: "boom" }, 500);

    expect(calledUrl().searchParams.get("q")).toBe("GLD-9B2");
    expect(calledUrl().searchParams.get("error")).toBe("boom");
  });

  it("follows the cursor while there is another page and budget left", async () => {
    wreck.get
      .mockResolvedValueOnce(page([{ _id: "a" }], true))
      .mockResolvedValueOnce(page([{ _id: "b" }], false));

    expect(await findCwDeadLetterIds("inbox", {}, 500)).toEqual(["a", "b"]);
    expect(wreck.get).toHaveBeenCalledTimes(2);
    expect(new URL(wreck.get.mock.calls[1][0]).searchParams.get("cursor")).toBe(
      "cursor-1",
    );
  });

  it("stops at the limit, and never returns more ids than asked for", async () => {
    wreck.get.mockResolvedValue(page([{ _id: "a" }, { _id: "b" }], true));

    expect(await findCwDeadLetterIds("inbox", {}, 1)).toEqual(["a"]);
    expect(wreck.get).toHaveBeenCalledTimes(1);
  });

  it("stops when the pager says there is nothing more", async () => {
    wreck.get.mockResolvedValue(page([], false));

    expect(await findCwDeadLetterIds("outbox", {}, 500)).toEqual([]);
    expect(wreck.get).toHaveBeenCalledTimes(1);
  });
});

describe("redriveCwEvent / parkCwEvent / unparkCwEvent actor", () => {
  it("sends `by` as a query parameter on a redrive", async () => {
    wreck.post.mockResolvedValue({ payload: {} });

    await redriveCwEvent("inbox", ID, { by: "donatas" });

    expect(postedUrl().pathname).toBe(`/actuators/inbox/${ID}/redrive`);
    expect(postedUrl().searchParams.get("by")).toBe("donatas");
  });

  it("omits `by` entirely when nobody named themselves", async () => {
    wreck.post.mockResolvedValue({ payload: {} });

    await redriveCwEvent("inbox", ID);

    expect(postedUrl().search).toBe("");
    expect(wreck.post.mock.calls[0][1]).toEqual({
      json: true,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  });

  it("percent-encodes an actor with awkward characters", async () => {
    wreck.post.mockResolvedValue({ payload: {} });

    await redriveCwEvent("inbox", ID, { by: "a b&c" });

    expect(postedUrl().searchParams.get("by")).toBe("a b&c");
  });

  it("posts the park reason as a body and the actor as a query parameter", async () => {
    wreck.post.mockResolvedValue({ payload: {} });

    await parkCwEvent("outbox", ID, { reason: "poison", by: "donatas" });

    expect(postedUrl().pathname).toBe(`/actuators/outbox/${ID}/park`);
    expect(postedUrl().searchParams.get("by")).toBe("donatas");
    expect(wreck.post.mock.calls[0][1].payload).toEqual({ reason: "poison" });
  });

  it("posts an unpark with no body at all", async () => {
    wreck.post.mockResolvedValue({ payload: {} });

    await unparkCwEvent("inbox", ID, { by: "donatas" });

    expect(postedUrl().pathname).toBe(`/actuators/inbox/${ID}/unpark`);
    expect(wreck.post.mock.calls[0][1]).not.toHaveProperty("payload");
  });

  it("turns a Caseworking 404 into a 404", async () => {
    wreck.post.mockRejectedValue(Boom.notFound("nope"));

    await expect(
      parkCwEvent("inbox", ID, { reason: "x" }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });

  it("turns a park conflict into a 409 naming DEAD_LETTER as the expected status", async () => {
    const conflict = Boom.conflict("nope");
    conflict.data = { payload: { status: "COMPLETED" } };
    wreck.post.mockRejectedValue(conflict);

    const error = await parkCwEvent("inbox", ID, { reason: "x" }).catch(
      (e) => e,
    );

    expect(error.output.statusCode).toBe(409);
    expect(error.output.payload.status).toBe("COMPLETED");
    expect(error.message).toContain("not DEAD_LETTER");
  });

  it("turns an unpark conflict into a 409 naming PARKED as the expected status", async () => {
    const conflict = Boom.conflict("nope");
    conflict.data = { payload: { status: "DEAD_LETTER" } };
    wreck.post.mockRejectedValue(conflict);

    const error = await unparkCwEvent("inbox", ID).catch((e) => e);

    expect(error.output.statusCode).toBe(409);
    expect(error.message).toContain("not PARKED");
  });

  it("reads PARKED back out of a conflict body, so a park/unpark race reads correctly", async () => {
    const conflict = Boom.conflict("nope");
    conflict.data = { payload: { status: "PARKED" } };
    wreck.post.mockRejectedValue(conflict);

    const error = await parkCwEvent("inbox", ID, { reason: "x" }).catch(
      (e) => e,
    );

    expect(error.output.payload.status).toBe("PARKED");
  });

  it("is a 502 when Caseworking is not configured", async () => {
    cwBackend.url = undefined;

    await expect(unparkCwEvent("inbox", ID)).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
  });
});
