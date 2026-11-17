import hapi from "@hapi/hapi";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { exploreQueryUseCase } from "../use-cases/explore-query.use-case.js";
import { exploreQueryRoute } from "./explore-query.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/explore-query.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };
const SENTINEL = "Sentinel Farm 4417";

const ANSWER = {
  source: { name: "applications", noun: "application" },
  mode: "rows",
  read: "exact",
  columns: [{ key: "c0", label: "clientRef", kind: "text", aggregate: false }],
  rows: [
    { open: { kind: "application", code: "g", ref: "r" }, cells: { c0: "r" } },
  ],
  count: { n: 1, capped: false },
  groups: false,
  unwound: false,
  unseen: ["phases.answers.aplicant"],
  partial: false,
  window: null,
};

describe("exploreQueryRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(exploreQueryRoute);
    await server.initialize();
  });

  afterAll(() => server.stop());

  const post = (payload, headers = HEADERS) =>
    server.inject({
      method: "POST",
      url: "/grant-admin/explore/query",
      headers,
      payload,
    });

  it("answers the query, never to be stored, with the operator and caller", async () => {
    exploreQueryUseCase.mockResolvedValue(ANSWER);

    const response = await post({
      query: "db.applications.find()",
      positions: null,
      limit: 10,
      csv: false,
    });

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(ANSWER);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(exploreQueryUseCase).toHaveBeenCalledWith({
      body: {
        query: "db.applications.find()",
        positions: null,
        limit: 10,
        csv: false,
      },
      actorId: OID,
      actor: "Jo Operator",
      roles: undefined,
      caller: "fg-grants-platform-admin",
      signal: expect.any(AbortSignal),
    });
  });

  it("passes the user's roles", async () => {
    exploreQueryUseCase.mockResolvedValue({ ok: true, source: "payments" });

    await post(
      { query: "db.x", check: true },
      { ...HEADERS, "x-actor-roles": "a, b" },
    );

    expect(exploreQueryUseCase.mock.calls[0][0].roles).toBe("a, b");
  });

  it("refuses text far over a query's length", async () => {
    expect((await post({ query: "x".repeat(4101) })).statusCode).toBe(400);
    expect(exploreQueryUseCase).not.toHaveBeenCalled();
  });

  it("answers a check", async () => {
    exploreQueryUseCase.mockResolvedValue({ ok: true, source: "cases" });

    expect(
      (await post({ query: "db.cases.find()", check: true })).result,
    ).toEqual({
      ok: true,
      source: "cases",
    });
  });

  it("passes windows and the legacy vocabulary flag on, and answers the vocabulary", async () => {
    const vocabulary = { sources: [] };
    const joined = {
      ...ANSWER,
      read: "windowed",
      window: { to: null, end: true, positions: null, skipped: 0 },
      windowRows: [1, 0],
      stopped: { statusCode: 408, code: "QUERY_TOO_SLOW" },
      vocabulary,
    };

    exploreQueryUseCase.mockResolvedValue(joined);

    const response = await post({
      query: "db.applications.find()",
      windows: 2,
      vocabulary: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(joined);
    expect(exploreQueryUseCase.mock.calls[0][0].body).toMatchObject({
      windows: 2,
      vocabulary: true,
    });
  });

  it("answers a check with its vocabulary, or null for one unread", async () => {
    exploreQueryUseCase.mockResolvedValue({
      ok: true,
      source: "cases",
      vocabulary: null,
    });

    const response = await post({
      query: "db.cases.find()",
      check: true,
      vocabulary: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.result.vocabulary).toBeNull();
  });

  it.each([
    ["no actor id", { "x-actor": "Jo" }, { query: "db.x" }],
    ["over 50 windows", HEADERS, { query: "db.x", windows: 51 }],
    ["no windows", HEADERS, { query: "db.x", windows: 0 }],
    ["windows of a CSV", HEADERS, { query: "db.x", csv: true, windows: 2 }],
    ["an unknown key", HEADERS, { query: "db.x", where: { $where: "1" } }],
    ["a limit over 5,000", HEADERS, { query: "db.x", limit: 5001 }],
    ["a query that isn't text", HEADERS, { query: { $gt: "" } }],
  ])("refuses %s, logging no value", async (_, headers, payload) => {
    const response = await post({ ...payload, positions: SENTINEL }, headers);

    expect(response.statusCode).toBe(400);
    expect(exploreQueryUseCase).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("Sentinel");
  });
});

describe("exploreQueryRoute over a real socket", () => {
  let live;

  beforeAll(async () => {
    live = hapi.server({ port: 0, host: "127.0.0.1" });
    live.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    live.route(exploreQueryRoute);
    await live.start();
  });

  afterAll(() => live.stop());

  const send = (payload) =>
    new Promise((resolve) => {
      const request = http.request({
        host: "127.0.0.1",
        port: live.info.port,
        method: "POST",
        path: "/grant-admin/explore/query",
        headers: { ...HEADERS, "content-type": "application/json" },
      });

      request.on("error", () => {});
      request.end(JSON.stringify(payload));
      resolve(request);
    });

  it("stops the query when the caller drops the connection after sending it", async () => {
    let stoppedAt = null;

    exploreQueryUseCase.mockImplementation(
      ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            stoppedAt = Date.now();
            resolve(ANSWER);
          });
        }),
    );

    const request = await send({ query: "db.applications.find()" });

    await vi.waitFor(() => expect(exploreQueryUseCase).toHaveBeenCalled());

    const droppedAt = Date.now();

    request.destroy();
    await vi.waitFor(() => expect(stoppedAt).not.toBeNull());

    expect(stoppedAt - droppedAt).toBeLessThan(200);
  });

  it("never stops a query whose answer was sent", async () => {
    let signal;

    exploreQueryUseCase.mockImplementation(async (args) => {
      signal = args.signal;

      return ANSWER;
    });

    const request = await send({ query: "db.applications.find()" });

    await new Promise((resolve) =>
      request.on("response", (res) => res.resume().on("end", resolve)),
    );

    expect(signal.aborted).toBe(false);
  });
});
