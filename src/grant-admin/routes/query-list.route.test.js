import hapi from "@hapi/hapi";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { logger } from "../../common/logger.js";
import { queryListUseCase } from "../use-cases/query-list.use-case.js";
import { queryListRoute } from "./query-list.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/query-list.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const LIST = {
  bucket: "gas.outbox",
  plan: {
    kind: "exact",
    index: [],
    bound: [],
    filled: [],
    residual: [],
    scans: 1,
  },
  rows: [],
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  groups: [],
  total: { count: 0, capped: false },
  pageRows: [0],
  stopped: null,
  refusedSearch: null,
};

describe("queryListRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(queryListRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    queryListUseCase.mockResolvedValue({ bucket: "gas.outbox", list: LIST });
  });

  const post = (payload, headers = HEADERS) =>
    server.inject({
      method: "POST",
      url: "/grant-admin/lists/query",
      headers,
      payload,
    });

  it("answers the list, never to be stored, from the body and the operator", async () => {
    const response = await post({
      path: "events/gas/outbox",
      params: { status: ["DEAD_LETTER", ""], error: "" },
      search: "ref:abc",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.result).toEqual({ bucket: "gas.outbox", list: LIST });
    expect(queryListUseCase).toHaveBeenCalledWith({
      ask: {
        path: "events/gas/outbox",
        params: { status: ["DEAD_LETTER", ""], error: "" },
        search: "ref:abc",
        pages: 1,
        repeat: false,
        read: true,
      },
      caller: "fg-grants-platform-admin",
      actor: "Jo Operator",
    });
  });

  it("answers a list not read as null", async () => {
    queryListUseCase.mockResolvedValue({ bucket: "gas.outbox", list: null });

    const response = await post({ path: "events/gas/outbox", read: false });

    expect(response.result).toEqual({ bucket: "gas.outbox", list: null });
  });

  it.each([
    ["no path", {}],
    ["pages with a cursor", { path: "a", cursor: "c", pages: 2 }],
    ["more than 50 pages", { path: "a", pages: 51 }],
    ["no pages", { path: "a", pages: 0 }],
    ["a value over its length", { path: "a", params: { k: "v".repeat(201) } }],
  ])("refuses %s, logging paths only", async (_, payload) => {
    const response = await post(payload);

    expect(response.statusCode).toBe(400);
    expect(queryListUseCase).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^Query list request refused: /),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("vvvv");
  });

  it("reads pages with no cursor, and one page with one", async () => {
    expect((await post({ path: "a", pages: 50 })).statusCode).toBe(200);
    expect((await post({ path: "a", cursor: "c", pages: 1 })).statusCode).toBe(
      200,
    );
  });

  it("refuses a read that names no operator", async () => {
    const response = await post({ path: "a" }, {});

    expect(response.statusCode).toBe(400);
  });
});
