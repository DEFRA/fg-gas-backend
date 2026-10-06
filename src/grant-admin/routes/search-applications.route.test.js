import Boom from "@hapi/boom";
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
import { searchApplicationsUseCase } from "../use-cases/search-applications.use-case.js";
import { searchApplicationsRoute } from "./search-applications.route.js";

vi.mock("../../common/logger.js");
vi.mock(
  "../use-cases/search-applications.use-case.js",
  async (importOriginal) => ({
    ...(await importOriginal()),
    searchApplicationsUseCase: vi.fn(),
  }),
);

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };
const PAGE = {
  rows: [],
  pagination: { endCursor: null, hasNextPage: false },
  sourceErrors: [],
};

describe("searchApplicationsRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(searchApplicationsRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    searchApplicationsUseCase.mockResolvedValue(PAGE);
  });

  const post = (payload, headers = HEADERS) =>
    server.inject({
      method: "POST",
      url: "/grant-admin/applications/search",
      payload,
      headers,
    });

  it("is a POST, so a searched ref never sits in a logged URL", () => {
    expect(searchApplicationsRoute.method).toBe("POST");
    expect(searchApplicationsRoute.path).toBe(
      "/grant-admin/applications/search",
    );
  });

  it("answers the page, never to be stored", async () => {
    const response = await post({});

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(PAGE);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("passes the lowercased ref, the filters, the caller and the repeat flag", async () => {
    await post(
      {
        ref: " GLD-9B2 ",
        code: "woodland",
        from: "2026-06-15T00:00:00.000Z",
        to: "2026-06-16T00:00:00.000Z",
      },
      { ...HEADERS, "x-search-repeat": "1" },
    );

    expect(searchApplicationsUseCase).toHaveBeenCalledWith({
      ref: "gld-9b2",
      code: "woodland",
      from: "2026-06-15T00:00:00.000Z",
      to: "2026-06-16T00:00:00.000Z",
      caller: "fg-grants-platform-admin",
      repeat: true,
    });
  });

  it("is not a repeat without the header", async () => {
    await post({});

    expect(searchApplicationsUseCase.mock.calls[0][0].repeat).toBe(false);
  });

  it("is not a repeat on a later page, even with the header", async () => {
    await post({ cursor: "abc" }, { ...HEADERS, "x-search-repeat": "1" });

    expect(searchApplicationsUseCase.mock.calls[0][0].repeat).toBe(false);
  });

  it("answers 500 when the read fails", async () => {
    searchApplicationsUseCase.mockRejectedValue(Boom.internal());

    expect((await post({})).statusCode).toBe(500);
  });

  it.each([
    ["no x-actor", { "x-actor-id": OID }],
    ["no x-actor-id", { "x-actor": "Jo" }],
    [
      "an x-actor-id that is not an object id",
      { ...HEADERS, "x-actor-id": "jo" },
    ],
    ["a repeat flag other than 1", { ...HEADERS, "x-search-repeat": "yes" }],
  ])("refuses %s with 400", async (_name, headers) => {
    expect((await post({}, headers)).statusCode).toBe(400);
    expect(searchApplicationsUseCase).not.toHaveBeenCalled();
  });

  it.each([
    ["a ref with a cursor", { ref: "ref-1", cursor: "abc" }],
    ["a ref outside the clientRef alphabet", { ref: "ref_1!" }],
    [
      "a from after the to",
      { from: "2026-06-16T00:00:00.000Z", to: "2026-06-15T00:00:00.000Z" },
    ],
    ["an SBI", { sbi: "123456789" }],
  ])("refuses %s with 400", async (_name, payload) => {
    expect((await post(payload)).statusCode).toBe(400);
  });
});
