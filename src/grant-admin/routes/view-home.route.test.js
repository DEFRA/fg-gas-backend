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
import { findAdministeredGrants } from "../../grants/services/config-version.service.js";
import { findOperatorRoles } from "../services/operator-roles.js";
import { viewHomeRoute } from "./view-home.route.js";

vi.mock("../../common/logger.js");
vi.mock("../../grants/services/config-version.service.js");
vi.mock("../services/operator-roles.js");

const ACTOR_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": ACTOR_ID };

describe("viewHomeRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(viewHomeRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    findAdministeredGrants.mockResolvedValue([
      { code: "fptt", description: "Farming Payments" },
      { code: "woodland", description: "Woodland Management Plan" },
    ]);
  });

  const get = (headers = HEADERS) =>
    server.inject({ method: "GET", url: "/grant-admin/home", headers });

  it("is a GET on the home path", () => {
    expect(viewHomeRoute.method).toBe("GET");
    expect(viewHomeRoute.path).toBe("/grant-admin/home");
  });

  it("returns how many grant types the operator administers without caching it", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual({ grantTypeCount: 2 });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(findAdministeredGrants).toHaveBeenCalledWith({
      findUserRoles: findOperatorRoles,
    });
  });

  it("returns a count of none when the operator administers none", async () => {
    findAdministeredGrants.mockResolvedValue([]);

    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual({ grantTypeCount: 0 });
  });

  it("ignores roles a caller names in a header", async () => {
    const response = await get({
      ...HEADERS,
      "x-user-roles": "ROLE_WOODLAND_ADMIN",
    });

    expect(response.statusCode).toBe(200);
    expect(findAdministeredGrants).toHaveBeenCalledWith({
      findUserRoles: findOperatorRoles,
    });
  });

  it.each([
    ["x-actor", { "x-actor-id": ACTOR_ID }],
    ["x-actor-id", { "x-actor": "Jo Operator" }],
  ])("requires the %s operator header", async (_, headers) => {
    expect((await get(headers)).statusCode).toBe(400);
    expect(findAdministeredGrants).not.toHaveBeenCalled();
  });

  it("answers 503 when the domain cannot determine the operator's roles", async () => {
    findAdministeredGrants.mockRejectedValue(
      Boom.serverUnavailable("Caseworking roles could not be determined"),
    );

    expect((await get()).statusCode).toBe(503);
  });

  it("propagates an unexpected failure as 500", async () => {
    findAdministeredGrants.mockRejectedValue(new Error("database failed"));

    expect((await get()).statusCode).toBe(500);
  });
});
