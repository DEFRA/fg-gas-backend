import Boom from "@hapi/boom";
import hapi from "@hapi/hapi";
import { createHash } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { auth } from "../../auth/auth.js";
import { db } from "../../common/mongo-client.js";
import { checkGrantAllowListUseCase } from "../use-cases/check-grant-allow-list.use-case.js";
import {
  checkAllowListRoute,
  missingAllowListIdentifiersRoute,
} from "./check-allow-list.route.js";

vi.mock("../../common/mongo-client.js", () => ({
  db: { collection: vi.fn() },
}));
vi.mock("../use-cases/check-grant-allow-list.use-case.js");

// Synthetic unit-test credentials, never generated deployment credentials.
const tokens = {
  "test-grants-ui-token": { clientId: "grants-ui", expiresAt: null },
  "test-sfd-token": { clientId: "single-front-door", expiresAt: null },
  "test-legacy-grants-ui-token": { client: "grants-ui", expiresAt: null },
  "test-mixed-token": {
    clientId: "grants-ui",
    client: "different-service",
    expiresAt: null,
  },
  "test-blank-client-id-token": {
    clientId: " ",
    client: "grants-ui",
    expiresAt: null,
  },
  "test-unidentified-token": { expiresAt: null },
  "test-unusable-identity-token": {
    clientId: 123,
    client: " ",
    expiresAt: null,
  },
  "test-expired-token": {
    clientId: "expired",
    expiresAt: new Date("2000-01-01"),
  },
};
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const records = Object.fromEntries(
  Object.entries(tokens).map(([raw, record]) => [
    hash(raw),
    { ...record, id: hash(raw) },
  ]),
);
const base = "/api/allow-list/grants/woodland";
const uri = `${base}/sbi/900000002/crn/9000000001`;
const headers = { authorization: "Bearer test-grants-ui-token" };

describe("allow-list routes", () => {
  let server;
  beforeAll(async () => {
    db.collection.mockReturnValue({
      findOne: vi.fn(async ({ id }) => records[id] ?? null),
    });
    server = hapi.server({ router: { stripTrailingSlash: true } });
    await server.register(auth);
    server.route([checkAllowListRoute, missingAllowListIdentifiersRoute]);
    await server.initialize();
  });
  afterAll(async () => {
    await server.stop();
  });
  beforeEach(() => {
    checkGrantAllowListUseCase.mockResolvedValue({ allowed: true });
  });

  it("checks eligibility without a configuration version", async () => {
    const response = await server.inject({ url: uri, headers });
    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual({ allowed: true });
    expect(checkGrantAllowListUseCase).toHaveBeenCalledWith({
      grantCode: "woodland",
      sbi: "900000002",
      crn: "9000000001",
      caller: "grants-ui",
    });
  });

  it.each([
    "configVersion=1.2.3",
    "configVersion=2.0.0",
    "configVersion=1.2.3&configVersion=2.0.0",
    "unexpected=value",
  ])("rejects unsupported query parameters: %s", async (query) => {
    const response = await server.inject({ url: `${uri}?${query}`, headers });
    expect(response.statusCode).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(checkGrantAllowListUseCase).not.toHaveBeenCalled();
  });

  it.each([
    ["test-grants-ui-token", "grants-ui", true],
    ["test-legacy-grants-ui-token", "grants-ui", true],
    ["test-mixed-token", "grants-ui", true],
    ["test-blank-client-id-token", "grants-ui", true],
    ["test-sfd-token", "single-front-door", false],
  ])(
    "accepts %s and derives caller from authentication",
    async (token, caller, allowed) => {
      checkGrantAllowListUseCase.mockResolvedValue({ allowed });
      const response = await server.inject({
        url: uri,
        headers: { authorization: `Bearer ${token}`, "x-actor": "spoofed" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.result).toEqual({ allowed });
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(checkGrantAllowListUseCase).toHaveBeenCalledWith({
        grantCode: "woodland",
        sbi: "900000002",
        crn: "9000000001",
        caller,
      });
    },
  );

  it.each([
    undefined,
    "Bearer invalid-test-token",
    "Bearer test-expired-token",
  ])(
    "rejects missing, invalid or expired authentication: %s",
    async (authorization) => {
      const response = await server.inject({
        url: uri,
        headers: authorization ? { authorization } : {},
      });
      expect(response.statusCode).toBe(401);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(checkGrantAllowListUseCase).not.toHaveBeenCalled();
    },
  );

  it("prevents caching authentication errors on the omitted-identifier route", async () => {
    const response = await server.inject({ url: base });
    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("prevents caching unknown paths within the allow-list API", async () => {
    const response = await server.inject({ url: `${base}/unrelated`, headers });
    expect(response.statusCode).toBe(404);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("preserves leading zeroes in both identifiers", async () => {
    const response = await server.inject({
      url: `${base}/sbi/000000001/crn/0000000001`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(checkGrantAllowListUseCase).toHaveBeenCalledWith({
      grantCode: "woodland",
      sbi: "000000001",
      crn: "0000000001",
      caller: "grants-ui",
    });
  });

  it.each(["test-unidentified-token", "test-unusable-identity-token"])(
    "refuses to release a decision without an authenticated caller identity: %s",
    async (token) => {
      const response = await server.inject({
        url: uri,
        headers: {
          authorization: `Bearer ${token}`,
          clientId: "grants-ui",
          "x-actor": "grants-ui",
        },
      });
      expect(response.statusCode).toBe(401);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(checkGrantAllowListUseCase).not.toHaveBeenCalled();
      expect(response.result).not.toHaveProperty("allowed");
    },
  );

  it.each([
    [{ service: "grants-ui", tokenId: "synthetic" }, 200],
    [{ tokenId: "synthetic" }, 401],
  ])(
    "handles credentials without artifacts: %j",
    async (credentials, status) => {
      const response = await server.inject({
        url: uri,
        auth: { strategy: "service", credentials },
      });

      expect(response.statusCode).toBe(status);
      expect(response.headers["cache-control"]).toBe("no-store");
      if (status === 200) {
        expect(response.result).toEqual({ allowed: true });
      } else {
        expect(response.result.message).toBe("Service identity required");
        expect(checkGrantAllowListUseCase).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    `${base}/sbi/10600003/crn/9000000001`,
    `${base}/sbi/1060000333/crn/9000000001`,
    `${base}/sbi/10600A033/crn/9000000001`,
    `${base}/sbi/900000002/crn/104200000`,
    `${base}/sbi/900000002/crn/10420000000`,
    `${base}/sbi/900000002/crn/10420A0000`,
    "/api/allow-list/grants/Bad_Code/sbi/900000002/crn/9000000001",
  ])("returns 400 for malformed input %s", async (url) => {
    const response = await server.inject({ url, headers });
    expect(response.statusCode).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(checkGrantAllowListUseCase).not.toHaveBeenCalled();
  });

  it.each([
    base,
    `${base}/sbi`,
    `${base}/sbi/900000002`,
    `${base}/sbi/900000002/crn`,
    `${base}/sbi/900000002/crn/`,
    `${base}/sbi/crn/9000000001`,
    `${base}/sbi//crn/9000000001`,
    `${base}/crn/9000000001`,
  ])("returns 400 for an omitted identifier %s", async (url) => {
    const response = await server.inject({ url, headers });
    expect(response.statusCode).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(checkGrantAllowListUseCase).not.toHaveBeenCalled();
  });

  it.each(["/unrelated", `${base}/unrelated`, `${uri}/unrelated`])(
    "keeps unrelated URLs as 404: %s",
    async (url) => {
      const response = await server.inject({ url, headers });
      expect(response.statusCode).toBe(404);
      expect(checkGrantAllowListUseCase).not.toHaveBeenCalled();
    },
  );

  it("propagates unknown grants as 404", async () => {
    checkGrantAllowListUseCase.mockRejectedValue(
      Boom.notFound("Unknown grant"),
    );
    const response = await server.inject({ url: uri, headers });
    expect(response.statusCode).toBe(404);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it.each(["storage failed", "audit failed"])(
    "propagates %s as a server error",
    async (message) => {
      checkGrantAllowListUseCase.mockRejectedValue(new Error(message));
      const response = await server.inject({ url: uri, headers });
      expect(response.statusCode).toBe(500);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.result).not.toHaveProperty("allowed");
    },
  );

  it("refuses an invalid decision response rather than exposing extra data", async () => {
    checkGrantAllowListUseCase.mockResolvedValue({
      allowed: true,
      global: { sbi: ["900000002"] },
    });
    const response = await server.inject({ url: uri, headers });
    expect(response.statusCode).toBe(500);
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
