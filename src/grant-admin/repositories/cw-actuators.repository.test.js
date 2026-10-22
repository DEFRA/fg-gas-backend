import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withRequestContext } from "../../common/get-request-context.js";
import { wreck } from "../../common/wreck.js";
import {
  CASE_NOT_FOUND,
  editCwPayload,
  findCwCase,
  findCwCaseExistence,
  findCwBuckets,
  findCwEvent,
  purgeCwEvent,
  queryCwBucket,
  readCwTimeline,
  summariseCwBucket,
  redriveCwEvent,
} from "./cw-actuators.repository.js";
import { describeError, isCwConfigured } from "./cw-http.js";

const { cwBackend } = vi.hoisted(() => ({
  cwBackend: { url: undefined, token: undefined },
}));

vi.mock("../../common/config.js", () => ({ config: { cwBackend } }));
vi.mock("../../common/logger.js");
vi.mock("../../common/wreck.js", () => ({
  wreck: { get: vi.fn(), post: vi.fn() },
}));

const URL_BASE = "http://cw.test";
const TOKEN = "cw-token";

const TIMEOUT_MS = 3000;

beforeEach(() => {
  cwBackend.url = URL_BASE;
  cwBackend.token = TOKEN;
  cwBackend.timeoutMs = TIMEOUT_MS;
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

describe("operator forwarding", () => {
  const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  it("sends the request's operator id on each call Caseworking audits", async () => {
    wreck.post.mockResolvedValue({ payload: {} });

    await withRequestContext({ user: OID }, () =>
      redriveCwEvent("inbox", ID, { by: "donatas" }),
    );

    expect(wreck.post.mock.calls[0][1].headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      "x-actor-id": OID,
    });
  });

  it("sends none when the request named no operator", async () => {
    wreck.get.mockResolvedValue({ payload: {} });

    await withRequestContext({}, () => findCwEvent("inbox", ID));

    expect(wreck.get.mock.calls[0][1].headers).not.toHaveProperty("x-actor-id");
  });
});

describe("Caseworking cases", () => {
  const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const ACTOR = "UTF-8''%C5%81ukasz";
  const KEY = { workflowCode: "frps-private-beta", caseRef: "ref-1" };
  const POSITION = { phase: "PRE_AWARD", stage: "REVIEW", status: "RECEIVED" };

  const aCase = (caseRef, replaced = false) => ({
    ref: { caseRef, workflowCode: "frps-private-beta" },
    position: POSITION,
    closed: false,
    closedAt: null,
    createdAt: "2026-06-16T10:00:00.000Z",
    replaced,
  });

  const SERIES = {
    latestRef: "ref-1",
    refs: ["ref-0", "ref-1"],
    members: [
      {
        caseRef: "ref-0",
        position: POSITION,
        createdAt: "2026-06-15T10:00:00.000Z",
        closedAt: "2026-06-16T09:00:00.000Z",
      },
      {
        caseRef: "ref-1",
        position: POSITION,
        createdAt: "2026-06-16T10:00:00.000Z",
        closedAt: null,
      },
    ],
  };

  const aCaseAnswer = (document) => ({
    payload: {
      case: {
        ...aCase("ref-1"),
        originalConfigVersion: "1.0.0",
        currentConfigVersion: "1.1.0",
        series: SERIES,
      },
      storedBytes: 4096,
      ...(document ? { document } : {}),
    },
  });

  const inRequest = (call) => withRequestContext({ user: OID }, call);

  it("reads one case, with its document only when asked", async () => {
    wreck.get.mockResolvedValue(aCaseAnswer());

    await inRequest(() => findCwCase(KEY, { actor: ACTOR }));
    await inRequest(() =>
      findCwCase(KEY, { actor: ACTOR, include: "document" }),
    );

    const [summaryUrl, wholeUrl] = wreck.get.mock.calls.map(
      ([url]) => new URL(url),
    );
    expect(summaryUrl.pathname).toBe(
      "/actuators/cases/frps-private-beta/ref-1",
    );
    expect(summaryUrl.search).toBe("");
    expect(wholeUrl.searchParams.get("include")).toBe("document");
    expect(wreck.get.mock.calls[0][1].headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      "x-actor-id": OID,
      "x-actor": ACTOR,
    });
  });

  it("answers the case as a flat summary with its series members, its stored size and its document", async () => {
    wreck.get.mockResolvedValue(aCaseAnswer({ caseRef: "ref-1" }));

    expect(await findCwCase(KEY, { include: "document" })).toEqual({
      summary: {
        caseRef: "ref-1",
        workflowCode: "frps-private-beta",
        position: POSITION,
        closed: false,
        closedAt: null,
        createdAt: "2026-06-16T10:00:00.000Z",
        originalConfigVersion: "1.0.0",
        currentConfigVersion: "1.1.0",
        series: SERIES,
      },
      storedBytes: 4096,
      document: { caseRef: "ref-1" },
    });
  });

  it("leaves members off a series from a Caseworking that predates them", async () => {
    const answer = aCaseAnswer();
    answer.payload.case.series = { latestRef: "ref-1", refs: ["ref-1"] };
    wreck.get.mockResolvedValue(answer);

    expect((await findCwCase(KEY, {})).summary.series).toEqual({
      latestRef: "ref-1",
      refs: ["ref-1"],
    });
  });

  it("maps away anything else Caseworking adds to a series or its members", async () => {
    const answer = aCaseAnswer();
    answer.payload.case.series = {
      ...SERIES,
      anything: true,
      members: SERIES.members.map((member) => ({ ...member, anything: 1 })),
    };
    wreck.get.mockResolvedValue(answer);

    expect((await findCwCase(KEY, {})).summary.series).toEqual(SERIES);
  });

  it("answers a null series as null", async () => {
    const answer = aCaseAnswer();
    answer.payload.case.series = null;
    wreck.get.mockResolvedValue(answer);

    expect((await findCwCase(KEY, {})).summary.series).toBeNull();
  });

  it("answers no document when none was asked for", async () => {
    wreck.get.mockResolvedValue(aCaseAnswer());

    expect((await findCwCase(KEY, {})).document).toBeNull();
  });

  it("reads a case whose document is over the read limit again without it, as too large", async () => {
    wreck.get.mockRejectedValueOnce(
      Boom.entityTooLarge(
        "Payload content length greater than maximum allowed",
      ),
    );
    wreck.get.mockResolvedValueOnce(aCaseAnswer());

    const found = await findCwCase(KEY, { include: "document" });

    expect(found).toMatchObject({
      summary: { caseRef: "ref-1" },
      storedBytes: 4096,
      document: null,
      tooLarge: true,
    });
    const [first, second] = wreck.get.mock.calls.map(([url]) => new URL(url));
    expect(first.searchParams.get("include")).toBe("document");
    expect(second.search).toBe("");
  });

  it("asks whether a case exists with the operator's id but no operator name", async () => {
    wreck.get.mockResolvedValue({ payload: { exists: true } });

    expect(await inRequest(() => findCwCaseExistence(KEY))).toEqual({
      exists: true,
    });
    expect(new URL(wreck.get.mock.calls[0][0]).pathname).toBe(
      "/actuators/cases/frps-private-beta/ref-1/existence",
    );
    expect(wreck.get.mock.calls[0][1].headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      "x-actor-id": OID,
    });
  });

  it("answers a missing case 404 with its reason, naming no ref", async () => {
    wreck.get.mockRejectedValue(
      httpError(404, { statusCode: 404, reason: CASE_NOT_FOUND }),
    );

    const error = await findCwCase(KEY, {}).catch((e) => e);

    expect(error.output.statusCode).toBe(404);
    expect(error.output.payload).toMatchObject({
      message: "case not found",
      reason: CASE_NOT_FOUND,
    });
  });

  it("answers a 404 without a reason - a route this Caseworking lacks - as a 502", async () => {
    wreck.get.mockRejectedValue(httpError(404, { message: "Not Found" }));

    const error = await findCwCaseExistence(KEY).catch((e) => e);

    expect(error.output.statusCode).toBe(502);
  });

  it("answers a timeout as a 504 and anything else as a 502", async () => {
    wreck.get.mockRejectedValueOnce(httpError(504));
    wreck.get.mockRejectedValueOnce(httpError(500, { message: "boom" }));

    expect((await findCwCase(KEY, {}).catch((e) => e)).output.statusCode).toBe(
      504,
    );
    expect((await findCwCase(KEY, {}).catch((e) => e)).output.statusCode).toBe(
      502,
    );
  });

  it("leaves an event 404 a 404, reason or not", async () => {
    wreck.get.mockRejectedValue(httpError(404));

    const error = await findCwEvent("inbox", ID).catch((e) => e);

    expect(error.output.statusCode).toBe(404);
  });
});

describe("Caseworking buckets", () => {
  const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const ACTOR = "UTF-8''%C5%81ukasz";

  const anEntry = (overrides) => ({
    id: "cw.example",
    path: "cw/example",
    label: "Example",
    service: "CW",
    shortLabel: "Example",
    icon: null,
    order: 80,
    noun: { one: "example", many: "examples" },
    time: { label: "Created" },
    facts: [
      {
        name: "closed",
        param: "closed",
        label: "Closed",
        values: [{ value: "true", label: "Closed" }],
        toggle: null,
      },
    ],
    refs: [{ kind: "ref", label: "Reference" }],
    indexes: [[]],
    groupings: [],
    title: { label: "Reference", format: "mono" },
    columns: [],
    audited: true,
    timeline: false,
    summaries: [],
    page: null,
    tab: null,
    ...overrides,
  });

  const failure = (statusCode, payload) => {
    const error = new Boom.Boom("failed", { statusCode });

    error.data = { payload };

    return error;
  };

  const inRequest = (call) => withRequestContext({ user: OID }, call);

  describe("findCwBuckets", () => {
    it("reads Caseworking's catalogue", async () => {
      wreck.get.mockResolvedValue({ payload: { buckets: [anEntry()] } });

      expect(await inRequest(() => findCwBuckets())).toEqual([anEntry()]);

      const [url, options] = wreck.get.mock.calls[0];
      expect(url).toBe(`${URL_BASE}/actuators/buckets`);
      expect(options.headers).toEqual({
        authorization: `Bearer ${TOKEN}`,
        "x-actor-id": OID,
      });
      expect(options.timeout).toBe(TIMEOUT_MS);
    });

    it("keeps only the entries whose id Caseworking owns", async () => {
      wreck.get.mockResolvedValue({
        payload: {
          buckets: [anEntry(), anEntry({ id: "gas.example" })],
        },
      });

      expect((await findCwBuckets()).map(({ id }) => id)).toEqual([
        "cw.example",
      ]);
    });

    it.each([
      ["no list of buckets", {}],
      ["an entry without its facts", { buckets: [{ id: "cw.example" }] }],
      ["no body", null],
    ])("answers 502 for %s", async (_, payload) => {
      wreck.get.mockResolvedValue({ payload });

      const error = await findCwBuckets().catch((e) => e);

      expect(error.output.statusCode).toBe(502);
      expect(error.message).toBe(
        "CW-BE answered a bucket catalogue that cannot be read",
      );
    });

    it("answers 502 when Caseworking is not configured", async () => {
      cwBackend.url = undefined;

      const error = await findCwBuckets().catch((e) => e);

      expect(error.output.statusCode).toBe(502);
      expect(wreck.get).not.toHaveBeenCalled();
    });

    it("answers 502 when Caseworking fails", async () => {
      wreck.get.mockRejectedValue(failure(500, { message: "SECRET" }));

      const error = await findCwBuckets().catch((e) => e);

      expect(error.output.statusCode).toBe(502);
      expect(error.message).toBe("CW-BE buckets unavailable: HTTP 500");
    });
  });

  describe("queryCwBucket", () => {
    const BODY = { where: { closed: true }, limit: 20 };
    const ANSWER = { bucket: "cw.example", rows: [] };

    it("posts the body to the bucket, as the operator", async () => {
      wreck.post.mockResolvedValue({ payload: ANSWER });

      const answer = await inRequest(() =>
        queryCwBucket("cw.example", BODY, { actor: ACTOR, repeat: true }),
      );

      const [url, options] = wreck.post.mock.calls[0];
      expect(answer).toBe(ANSWER);
      expect(url).toBe(`${URL_BASE}/actuators/buckets/cw.example/query`);
      expect(options.payload).toEqual(BODY);
      expect(options.headers).toEqual({
        authorization: `Bearer ${TOKEN}`,
        "x-actor-id": OID,
        "x-actor": ACTOR,
        "x-search-repeat": "1",
      });
      expect(options.timeout).toBe(TIMEOUT_MS);
    });

    it("sends no repeat flag unless it is a repeat", async () => {
      wreck.post.mockResolvedValue({ payload: ANSWER });

      await queryCwBucket("cw.example", BODY, { actor: ACTOR });

      expect(wreck.post.mock.calls[0][1].headers).not.toHaveProperty(
        "x-search-repeat",
      );
    });

    it("encodes the bucket id into the path", async () => {
      wreck.post.mockResolvedValue({ payload: ANSWER });

      await queryCwBucket("cw.a/b", BODY);

      expect(new URL(wreck.post.mock.calls[0][0]).pathname).toBe(
        "/actuators/buckets/cw.a%2Fb/query",
      );
    });

    it.each([
      [400, "UNKNOWN_FACT", 400],
      [400, "INVALID_CURSOR", 400],
      [404, "UNKNOWN_BUCKET", 404],
      [504, "TIMED_OUT", 504],
    ])(
      "rebuilds a %i refusal from its reason %s alone",
      async (statusCode, reason, answered) => {
        wreck.post.mockRejectedValue(
          failure(statusCode, { reason, message: "SECRET-CW-MESSAGE" }),
        );

        const error = await queryCwBucket("cw.example", BODY).catch((e) => e);

        expect(error.output.statusCode).toBe(answered);
        expect(error.output.payload.reason).toBe(reason);
        expect(JSON.stringify(error.output.payload)).not.toContain("SECRET");
      },
    );

    it("reads the reason from a raw body too", async () => {
      wreck.post.mockRejectedValue(
        failure(400, Buffer.from(JSON.stringify({ reason: "INVALID_RANGE" }))),
      );

      const error = await queryCwBucket("cw.example", BODY).catch((e) => e);

      expect(error.output.payload.reason).toBe("INVALID_RANGE");
    });

    it("answers 502 for a 404 without a reason: a Caseworking with no bucket routes", async () => {
      wreck.post.mockRejectedValue(failure(404, { message: "Not Found" }));

      const error = await queryCwBucket("cw.example", BODY).catch((e) => e);

      expect(error.output.statusCode).toBe(502);
      expect(error.message).toBe("CW-BE has no bucket routes");
    });

    it.each([
      ["a 400 with a reason it does not know", 400, { reason: "SOMETHING" }],
      ["a 400 with no body", 400, undefined],
      ["a 500", 500, { reason: "UNKNOWN_FACT" }],
    ])("answers 502 for %s", async (_, statusCode, payload) => {
      wreck.post.mockRejectedValue(failure(statusCode, payload));

      const error = await queryCwBucket("cw.example", BODY).catch((e) => e);

      expect(error.output.statusCode).toBe(502);
      expect(error.output.payload).not.toHaveProperty("reason");
    });

    it.each([504, 408])(
      "answers TIMED_OUT when Caseworking answers %i",
      async (statusCode) => {
        wreck.post.mockRejectedValue(failure(statusCode));

        const error = await queryCwBucket("cw.example", BODY).catch((e) => e);

        expect(error.output.statusCode).toBe(504);
        expect(error.output.payload.reason).toBe("TIMED_OUT");
      },
    );

    it("answers 502 when Caseworking is not configured", async () => {
      cwBackend.token = undefined;

      const error = await queryCwBucket("cw.example", BODY).catch((e) => e);

      expect(error.output.statusCode).toBe(502);
      expect(wreck.post).not.toHaveBeenCalled();
    });
  });

  describe("summariseCwBucket", () => {
    const BODY = { from: "2026-10-08T12:00:00.000Z" };
    const ANSWER = {
      bucket: "cw.inbox",
      summary: "errors",
      entries: [
        {
          values: { errorKey: null, eventType: null },
          count: 2,
          capped: false,
          firstAt: null,
          lastAt: null,
        },
      ],
      more: false,
      complete: true,
    };

    it("posts the range to the bucket's summary, as the operator", async () => {
      wreck.post.mockResolvedValue({ payload: ANSWER });

      const answer = await inRequest(() =>
        summariseCwBucket("cw.inbox", "errors", BODY, { actor: ACTOR }),
      );

      const [url, options] = wreck.post.mock.calls[0];
      expect(answer).toEqual(ANSWER);
      expect(url).toBe(
        `${URL_BASE}/actuators/buckets/cw.inbox/summaries/errors`,
      );
      expect(options.payload).toEqual(BODY);
      expect(options.headers).toEqual({
        authorization: `Bearer ${TOKEN}`,
        "x-actor-id": OID,
        "x-actor": ACTOR,
      });
    });

    it("encodes the ids into the path", async () => {
      wreck.post.mockResolvedValue({ payload: ANSWER });

      await summariseCwBucket("cw.a/b", "c/d", BODY);

      expect(new URL(wreck.post.mock.calls[0][0]).pathname).toBe(
        "/actuators/buckets/cw.a%2Fb/summaries/c%2Fd",
      );
    });

    it.each([
      ["no entries", { bucket: "cw.inbox", summary: "errors" }],
      ["no body", null],
    ])("answers 502 for %s", async (_, payload) => {
      wreck.post.mockResolvedValue({ payload });

      const error = await summariseCwBucket("cw.inbox", "errors", BODY).catch(
        (e) => e,
      );

      expect(error.output.statusCode).toBe(502);
    });
  });

  describe("readCwTimeline", () => {
    const TIMELINE = {
      buckets: [
        { id: "cw.outbox", label: "CW outbox", rows: [], more: false },
        { id: "cw.inbox", label: "CW inbox", rows: null, more: false },
      ],
    };

    it("posts the ref to Caseworking's timeline as the operator, in one call", async () => {
      wreck.post.mockResolvedValue({ payload: TIMELINE });

      const answer = await inRequest(() =>
        readCwTimeline("ref:abc-123", { actor: ACTOR }),
      );

      const [url, options] = wreck.post.mock.calls[0];
      expect(answer).toEqual(TIMELINE);
      expect(wreck.post).toHaveBeenCalledTimes(1);
      expect(wreck.get).not.toHaveBeenCalled();
      expect(url).toBe(`${URL_BASE}/actuators/timeline`);
      expect(options.payload).toEqual({ ref: "ref:abc-123" });
      expect(options.headers).toEqual({
        authorization: `Bearer ${TOKEN}`,
        "x-actor-id": OID,
        "x-actor": ACTOR,
      });
      expect(options.timeout).toBe(TIMEOUT_MS);
    });

    it.each([
      ["no list of buckets", {}],
      ["a bucket without its rows", { buckets: [{ id: "cw.inbox" }] }],
      ["no body", null],
    ])("answers 502 for %s", async (_, payload) => {
      wreck.post.mockResolvedValue({ payload });

      const error = await readCwTimeline("ref:abc-123").catch((e) => e);

      expect(error.output.statusCode).toBe(502);
    });

    it("answers 502 when Caseworking is not configured", async () => {
      cwBackend.token = undefined;

      const error = await readCwTimeline("ref:abc-123").catch((e) => e);

      expect(error.output.statusCode).toBe(502);
      expect(wreck.post).not.toHaveBeenCalled();
    });
  });
});
