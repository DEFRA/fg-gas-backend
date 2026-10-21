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
import { summariseBucketUseCase } from "../use-cases/summarise-bucket.use-case.js";
import { summariseBucketRoute } from "./summarise-bucket.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/summarise-bucket.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const ANSWER = {
  bucket: "gas.outbox",
  summary: "errors",
  entries: [
    {
      values: { errorKey: "TimeoutError", eventType: "Sent" },
      count: 3,
      capped: false,
      firstAt: "2026-10-01T08:00:00.000Z",
      lastAt: "2026-10-09T09:14:03.120Z",
    },
    {
      values: { errorKey: null, eventType: null },
      count: 1,
      capped: false,
      firstAt: null,
      lastAt: null,
    },
  ],
  more: false,
  complete: true,
};

describe("summariseBucketRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(summariseBucketRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    summariseBucketUseCase.mockResolvedValue(ANSWER);
  });

  const post = ({ payload, headers = HEADERS } = {}) =>
    server.inject({
      method: "POST",
      url: "/grant-admin/buckets/gas.outbox/summaries/errors",
      headers,
      payload,
    });

  it("answers the summary, never to be stored, in one use-case call", async () => {
    const response = await post({
      payload: { from: "2026-10-08T12:00:00.000Z" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(ANSWER);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(summariseBucketUseCase).toHaveBeenCalledExactlyOnceWith({
      bucketId: "gas.outbox",
      summaryId: "errors",
      body: { show: [], from: "2026-10-08T12:00:00.000Z" },
      actor: "Jo Operator",
    });
  });

  it("reads a POST with no body as a summary over all time", async () => {
    const response = await post();

    expect(response.statusCode).toBe(200);
    expect(summariseBucketUseCase.mock.calls[0][0].body).toEqual({ show: [] });
  });

  it.each([
    ["a filter", { where: { status: "FAILED" } }],
    ["a from that is not a date", { from: "yesterday" }],
  ])("refuses a body with %s", async (_, payload) => {
    const response = await post({ payload });

    expect(response.statusCode).toBe(400);
    expect(response.result.reason).toBe("INVALID_REQUEST");
    expect(summariseBucketUseCase).not.toHaveBeenCalled();
  });

  it("refuses a request that names no operator", async () => {
    const response = await post({ headers: {} });

    expect(response.statusCode).toBe(400);
    expect(summariseBucketUseCase).not.toHaveBeenCalled();
  });

  it.each([
    ["UNKNOWN_BUCKET", 404],
    ["UNKNOWN_SUMMARY", 404],
    ["TIMED_OUT", 504],
  ])("passes a %s refusal on with its reason", async (reason, statusCode) => {
    summariseBucketUseCase.mockRejectedValue(refuse(reason));

    const response = await post();

    expect(response.statusCode).toBe(statusCode);
    expect(response.result.reason).toBe(reason);
  });

  it("answers 500 for a summary that is not one", async () => {
    summariseBucketUseCase.mockResolvedValue({ bucket: "gas.outbox" });

    const response = await post();

    expect(response.statusCode).toBe(500);
  });
});
