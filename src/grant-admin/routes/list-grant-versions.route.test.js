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
import { grantNotFound } from "../services/grant-not-found.js";
import { listGrantVersionsUseCase } from "../use-cases/list-grant-versions.use-case.js";
import { listGrantVersionsRoute } from "./list-grant-versions.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/list-grant-versions.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const VERSIONS = {
  code: "woodland",
  current: null,
  versions: [
    {
      version: "2.0.0",
      status: "draft",
      receivedAt: "2026-10-15T10:04:00.000Z",
    },
  ],
};

describe("listGrantVersionsRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(listGrantVersionsRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    listGrantVersionsUseCase.mockResolvedValue(VERSIONS);
  });

  const get = (headers = HEADERS, code = "woodland") =>
    server.inject({
      method: "GET",
      url: `/grant-admin/grants/${code}/versions`,
      headers,
    });

  it("answers the grant's versions, never to be stored", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(VERSIONS);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(listGrantVersionsUseCase).toHaveBeenCalledWith({ code: "woodland" });
  });

  it("answers 404 with its reason for a grant with no versions", async () => {
    listGrantVersionsUseCase.mockRejectedValue(grantNotFound());

    const response = await get();

    expect(response.statusCode).toBe(404);
    expect(response.result.reason).toBe("GRANT_NOT_FOUND");
  });

  it.each([
    ["no x-actor", { "x-actor-id": OID }],
    ["no x-actor-id", { "x-actor": "Jo" }],
  ])("refuses %s with 400", async (_name, headers) => {
    expect((await get(headers)).statusCode).toBe(400);
    expect(listGrantVersionsUseCase).not.toHaveBeenCalled();
  });

  it("refuses a code outside the code alphabet with 400", async () => {
    expect((await get(HEADERS, "Woodland")).statusCode).toBe(400);
  });
});
