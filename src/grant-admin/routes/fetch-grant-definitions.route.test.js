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
import { fetchConfigDefinitions } from "../../grants/services/config-version.service.js";
import { configVersionNotFound } from "../../grants/services/config-version-not-found.js";
import { fetchGrantDefinitionsRoute } from "./fetch-grant-definitions.route.js";

vi.mock("../../common/logger.js");
vi.mock("../../grants/services/config-version.service.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const RESULT = {
  files: [
    { file: "grant", outcome: "stored" },
    {
      file: "agreement",
      outcome: "failed",
      reason: "invalid",
      message: "Agreement definition is not usable",
    },
    { file: "payment", outcome: "failed", reason: "missing", message: null },
  ],
};

describe("fetchGrantDefinitionsRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(fetchGrantDefinitionsRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    fetchConfigDefinitions.mockResolvedValue(RESULT);
  });

  const post = (headers = HEADERS, version = "2.0.0", code = "woodland") =>
    server.inject({
      method: "POST",
      url: `/grant-admin/grants/${code}/versions/${version}/fetch`,
      headers,
    });

  it("answers each file's outcome, from one call naming the grant, version and caller", async () => {
    const response = await post();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(RESULT);
    expect(fetchConfigDefinitions).toHaveBeenCalledWith({
      grantCode: "woodland",
      version: "2.0.0",
      caller: "fg-grants-platform-admin",
    });
  });

  it("answers no files when every one was already stored", async () => {
    fetchConfigDefinitions.mockResolvedValue({ files: [] });

    expect((await post()).result).toEqual({ files: [] });
  });

  it("answers 404 with its reason for an unknown version", async () => {
    fetchConfigDefinitions.mockRejectedValue(configVersionNotFound());

    const response = await post();

    expect(response.statusCode).toBe(404);
    expect(response.result.reason).toBe("GRANT_VERSION_NOT_FOUND");
  });

  it("answers 500 when the fetch stopped part-way", async () => {
    fetchConfigDefinitions.mockRejectedValue(
      Boom.internal("Fetch definitions stopped", { files: [] }),
    );

    expect((await post()).statusCode).toBe(500);
  });

  it.each([
    ["no x-actor", { "x-actor-id": OID }],
    ["no x-actor-id", { "x-actor": "Jo" }],
  ])("refuses %s with 400", async (_name, headers) => {
    expect((await post(headers)).statusCode).toBe(400);
    expect(fetchConfigDefinitions).not.toHaveBeenCalled();
  });

  it.each([
    ["a version that is not semver", "2.0", "woodland"],
    ["a code outside the code alphabet", "2.0.0", "Woodland"],
  ])("refuses %s with 400", async (_name, version, code) => {
    expect((await post(HEADERS, version, code)).statusCode).toBe(400);
    expect(fetchConfigDefinitions).not.toHaveBeenCalled();
  });

  it("refuses an outcome with no known reason", async () => {
    fetchConfigDefinitions.mockResolvedValue({
      files: [
        { file: "grant", outcome: "failed", reason: "lost", message: null },
      ],
    });

    expect((await post()).statusCode).toBe(500);
  });
});
