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
import { logger } from "../../common/logger.js";
import { updateEntitlement } from "../../grants/services/entitlement.service.js";
import { prefetchOperatorRoles } from "../services/operator-roles.js";
import { updateEntitlementRoute } from "./update-entitlement.route.js";

vi.mock("../../grants/services/entitlement.service.js");
vi.mock("../services/operator-roles.js");

const findHeldRoles = vi.fn();

beforeEach(() => {
  prefetchOperatorRoles.mockReturnValue(findHeldRoles);
});
vi.mock("../../common/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const url =
  "/grant-admin/grants/grant-1/applications/ref-1234/claims/entitlements/entitlement-1";

const payload = { data: { totalHectares: { value: 125000 } } };

describe("updateEntitlementRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(updateEntitlementRoute);
    await server.initialize();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    updateEntitlement.mockResolvedValue({ id: "entitlement-1" });
  });

  afterAll(async () => {
    await server.stop();
  });

  it("updates the entitlement in the url with the data supplied", async () => {
    const result = await server.inject({ method: "PUT", url, payload });

    expect(result.statusCode).toEqual(200);
    expect(updateEntitlement).toHaveBeenCalledWith(
      {
        code: "grant-1",
        clientRef: "ref-1234",
        entitlementId: "entitlement-1",
        data: payload.data,
        actor: null,
      },
      findHeldRoles,
    );
    expect(result.result).toEqual({ id: "entitlement-1" });
  });

  it("passes on the person who asked", async () => {
    await server.inject({
      method: "PUT",
      url,
      payload,
      headers: { "x-actor": "Ada Lovelace" },
    });

    expect(updateEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "Ada Lovelace" }),
      findHeldRoles,
    );
  });

  it("refuses a name longer than the audit record allows", async () => {
    const result = await server.inject({
      method: "PUT",
      url,
      payload,
      headers: { "x-actor": "a".repeat(129) },
    });

    expect(result.statusCode).toEqual(400);
    expect(updateEntitlement).not.toHaveBeenCalled();
  });

  it("refuses a payload with no data", async () => {
    const result = await server.inject({
      method: "PUT",
      url,
      payload: { data: {} },
    });

    expect(result.statusCode).toEqual(400);
    expect(updateEntitlement).not.toHaveBeenCalled();
  });

  it("passes on a refusal from the service", async () => {
    updateEntitlement.mockRejectedValue(Boom.conflict("claimed"));

    const result = await server.inject({ method: "PUT", url, payload });

    expect(result.statusCode).toEqual(409);
  });

  // Which roles may update is Grants' to decide, against the grant the
  // entitlement belongs to; the route only hands over the lookup and passes on
  // the outcome.
  describe("access by claims roles", () => {
    const send = () => server.inject({ method: "PUT", url, payload });

    it("hands Grants the operator's roles lookup without asking for the roles itself", async () => {
      expect((await send()).statusCode).toEqual(200);
      expect(updateEntitlement).toHaveBeenCalledExactlyOnceWith(
        expect.any(Object),
        findHeldRoles,
      );
      expect(findHeldRoles).not.toHaveBeenCalled();
    });

    it("passes on Grants' refusal with a 403", async () => {
      updateEntitlement.mockRejectedValue(Boom.forbidden());

      expect((await send()).statusCode).toEqual(403);
      expect(logger.info).toHaveBeenCalledWith(
        "Update entitlement requested for entitlement-1 for application with code grant-1 and clientRef ref-1234",
      );
    });

    it("passes on a failure to determine the operator's roles with a 503", async () => {
      updateEntitlement.mockRejectedValue(Boom.serverUnavailable());

      expect((await send()).statusCode).toEqual(503);
    });
  });
});
