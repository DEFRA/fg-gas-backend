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
import { refuse } from "../../common/buckets/refusal.js";
import { logger } from "../../common/logger.js";
import { queryBucketUseCase } from "../use-cases/query-bucket.use-case.js";
import { queryBucketRoute } from "./query-bucket.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/query-bucket.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const ANSWER = {
  bucket: "gas.outbox",
  plan: {
    kind: "exact",
    index: ["kind", "publicationDate", "_id"],
    bound: [],
    filled: [],
    residual: [],
    scans: 1,
  },
  rows: [
    {
      id: "66f000000000000000000001",
      time: "2026-10-09T09:14:03.120Z",
      title: "case.update.status",
      subtitle: "0b7c1d1e-0000-4000-8000-000000000001",
      cells: { status: "DEAD_LETTER", grantCode: null, completedAt: null },
      link: {
        kind: "event",
        service: "gas",
        box: "outbox",
        id: "66f000000000000000000001",
      },
    },
  ],
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  groups: [],
};

describe("queryBucketRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(queryBucketRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    queryBucketUseCase.mockResolvedValue(ANSWER);
  });

  const post = ({ payload, headers = HEADERS, bucketId = "gas.outbox" } = {}) =>
    server.inject({
      method: "POST",
      url: `/grant-admin/buckets/${bucketId}/query`,
      headers,
      payload,
    });

  it("answers one page, never to be stored, in one use-case call", async () => {
    const response = await post({
      payload: {
        where: { status: "DEAD_LETTER" },
        ref: "ref:abc-123",
        groupBy: ["status"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(ANSWER);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(queryBucketUseCase).toHaveBeenCalledWith({
      bucketId: "gas.outbox",
      body: {
        where: { status: "DEAD_LETTER" },
        show: [],
        ref: "ref:abc-123",
        limit: 20,
        groupBy: ["status"],
      },
      caller: "fg-grants-platform-admin",
      actor: "Jo Operator",
      repeat: false,
    });
  });

  it("reads a POST with no body as the empty query", async () => {
    const response = await post();

    expect(response.statusCode).toBe(200);
    expect(queryBucketUseCase.mock.calls[0][0].body).toEqual({
      where: {},
      show: [],
      limit: 20,
      groupBy: [],
    });
  });

  it("says when a page is a repeat of one the operator already saw", async () => {
    await post({ headers: { ...HEADERS, "x-search-repeat": "1" } });

    expect(queryBucketUseCase.mock.calls[0][0].repeat).toBe(true);
  });

  it("hands a malformed bucket id to the use case, which answers 404", async () => {
    queryBucketUseCase.mockRejectedValue(refuse("UNKNOWN_BUCKET"));

    const response = await post({ bucketId: "GAS.Outbox" });

    expect(response.statusCode).toBe(404);
    expect(response.result).toEqual({
      statusCode: 404,
      error: "Not Found",
      message: "No such bucket",
      reason: "UNKNOWN_BUCKET",
    });
  });

  it.each([
    ["a free-text search", { payload: { q: "SECRET-TEXT" } }],
    ["a prefix search", { payload: { prefix: "SECRET-TEXT" } }],
    ["a filter with a list of values", { payload: { where: { a: ["x"] } } }],
    ["a limit over the maximum", { payload: { limit: 101 } }],
    ["no operator name", { headers: { "x-actor-id": OID } }],
    ["no operator id", { headers: { "x-actor": "Jo Operator" } }],
    [
      "a repeat flag that is not 1",
      { headers: { ...HEADERS, "x-search-repeat": "yes" } },
    ],
  ])("refuses %s as INVALID_REQUEST, echoing nothing", async (_, request) => {
    const response = await post(request);

    expect(response.statusCode).toBe(400);
    expect(response.result).toEqual({
      statusCode: 400,
      error: "Bad Request",
      message: "The request is not a bucket query",
      reason: "INVALID_REQUEST",
    });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("SECRET");
    expect(queryBucketUseCase).not.toHaveBeenCalled();
  });

  it("passes the engine's refusal on with its reason", async () => {
    queryBucketUseCase.mockRejectedValue(refuse("TIMED_OUT"));

    const response = await post();

    expect(response.statusCode).toBe(504);
    expect(response.result.reason).toBe("TIMED_OUT");
  });

  it("answers 500 rather than a page that is not a bucket answer", async () => {
    queryBucketUseCase.mockResolvedValue({ ...ANSWER, rows: [{ id: "1" }] });

    const response = await post();

    expect(response.statusCode).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Query bucket response failed validation"),
    );
  });
});
