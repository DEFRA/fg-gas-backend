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
import { createEntitlement } from "../../grants/services/entitlement.service.js";
import { createEntitlementRoute } from "./create-entitlement.route.js";

vi.mock("../../grants/services/entitlement.service.js");
vi.mock("../../common/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const code = "woodland";
const clientRef = "wmp-abc-123";
const claimCode = "ENT_CS_CAPITAL_PA3";

const payload = {
  clientRef,
  grantCode: code,
  claimCode,
  data: { totalHectares: { value: 455000 } },
};

const entitlement = {
  id: "0e267c5a-1f0f-4c88-9a5e-30bb2c1f6fbb",
  clientRef,
  code,
  claimCode,
  configVersion: "1.1.0",
  data: { totalHectares: 455000 },
  createdAt: "2026-08-24T10:00:00.000Z",
};

const url = `/grant-admin/grants/${code}/applications/${clientRef}/claims/entitlements`;

describe("createEntitlementRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(createEntitlementRoute);
    await server.initialize();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("creates the entitlement and returns it with 201", async () => {
    createEntitlement.mockResolvedValue(entitlement);

    const result = await server.inject({ method: "POST", url, payload });

    expect(result.statusCode).toEqual(201);
    expect(createEntitlement).toHaveBeenCalledWith({
      code,
      clientRef,
      claimCode,
      data: payload.data,
    });
    expect(result.result).toEqual(entitlement);
  });

  it("refuses a payload carrying a field the request does not define", async () => {
    const result = await server.inject({
      method: "POST",
      url,
      payload: { ...payload, createdBy: "user-1" },
    });

    expect(result.statusCode).toEqual(400);
    expect(createEntitlement).not.toHaveBeenCalled();
  });

  it("refuses a payload whose clientRef does not match the URL", async () => {
    const result = await server.inject({
      method: "POST",
      url,
      payload: { ...payload, clientRef: "someone-else" },
    });

    expect(result.statusCode).toEqual(400);
    expect(createEntitlement).not.toHaveBeenCalled();
  });

  it("refuses a payload whose grantCode does not match the URL", async () => {
    const result = await server.inject({
      method: "POST",
      url,
      payload: { ...payload, grantCode: "another-grant" },
    });

    expect(result.statusCode).toEqual(400);
    expect(createEntitlement).not.toHaveBeenCalled();
  });

  it("refuses a payload without data", async () => {
    const { data, ...rest } = payload;

    const result = await server.inject({ method: "POST", url, payload: rest });

    expect(result.statusCode).toEqual(400);
  });

  it("refuses a data field without a value", async () => {
    const result = await server.inject({
      method: "POST",
      url,
      payload: { ...payload, data: { totalHectares: {} } },
    });

    expect(result.statusCode).toEqual(400);
  });

  it("returns the structured error body from the use case", async () => {
    const boom = Boom.conflict(
      `Cannot create entitlement '${claimCode}'. Maximum instance limit of 1 has been reached.`,
    );
    boom.output.payload.errorCode = "ENTITLEMENT_LIMIT_EXCEEDED";
    createEntitlement.mockRejectedValue(boom);

    const result = await server.inject({ method: "POST", url, payload });

    expect(result.statusCode).toEqual(409);
    expect(result.result).toMatchObject({
      statusCode: 409,
      errorCode: "ENTITLEMENT_LIMIT_EXCEEDED",
      message: `Cannot create entitlement '${claimCode}'. Maximum instance limit of 1 has been reached.`,
    });
  });
});
