import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listClaimableEntitlements } from "../services/claims.service.js";
import { getAvailableClaimsRoute } from "./get-available-claims.route.js";

vi.mock("../services/claims.service.js");
vi.mock("../../common/logger.js");

const availableClaim = {
  code: "ENT_CS_CAPITAL_PA3",
  name: "PA3 Woodland Management Plan entitlement",
  description: "The maximum eligible woodland area that can be claimed.",
  data: {
    totalHectares: {
      value: 455000,
      decimalPlaces: 4,
      minValue: 0.5,
      maxValue: null,
    },
    actionCode: {
      value: "PA3",
    },
    actionVersion: {
      value: "1.2.3",
    },
  },
};

const url = (grantCode, clientRef) =>
  `/grants/${grantCode}/entitlements/${clientRef}/available-claims`;

describe("getAvailableClaimsRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(getAvailableClaimsRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("returns available claims for a valid grantCode and clientRef", async () => {
    const grantCode = "woodland";
    const clientRef = "ref-1234";

    listClaimableEntitlements.mockResolvedValue([
      {
        ...availableClaim,
        source: "persisted",
        entitlementId: "entitlement-1",
        instanceNumber: 1,
        claim: { limits: { maximumClaims: 1 } },
      },
    ]);

    const result = await server.inject({
      method: "GET",
      url: url(grantCode, clientRef),
    });

    expect(result.statusCode).toEqual(200);
    expect(listClaimableEntitlements).toHaveBeenCalledWith({
      code: grantCode,
      clientRef,
    });
    // entitlementId crosses the boundary so the caller can name its target on
    // submit; source and instanceNumber stay internal.
    expect(result.result).toEqual({
      availableClaims: [{ ...availableClaim, entitlementId: "entitlement-1" }],
    });
  });

  it("returns empty list when nothing is available", async () => {
    listClaimableEntitlements.mockResolvedValue([]);

    const result = await server.inject({
      method: "GET",
      url: url("woodland", "ref-1234"),
    });

    expect(result.statusCode).toEqual(200);
    expect(result.result).toEqual({
      availableClaims: [],
    });
  });

  it("returns 400 for invalid grantCode parameter", async () => {
    const result = await server.inject({
      method: "GET",
      url: url("INVALID CODE!", "ref-1234"),
    });

    expect(result.statusCode).toEqual(400);
  });

  it("returns 400 for invalid clientRef parameter", async () => {
    const result = await server.inject({
      method: "GET",
      url: url("woodland", "INVALID REF!"),
    });

    expect(result.statusCode).toEqual(400);
  });
});
