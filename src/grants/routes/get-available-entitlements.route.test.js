import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findAvailableEntitlementTemplatesUseCase } from "../use-cases/find-available-entitements.use-case.js";
import { getAvailableEntitlementsRoute } from "./get-available-entitlements.route.js";

vi.mock("../use-cases/find-available-entitements.use-case.js");
vi.mock("../../common/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const template = {
  claimCode: "ENT_CS_CAPITAL_PA3",
  name: "PA3 Woodland Management Plan entitlement",
  description: "The maximum eligible woodland area that can be claimed.",
  materialised: false,
  fields: {
    totalHectares: {
      input: true,
      label: "Total area of eligible woodland",
      unitType: "decimal",
      decimalPlaces: 4,
      unit: "HA",
      minValue: 0.5,
      maxValue: null,
    },
  },
  maxEntitlements: 1,
  availableAt: {
    phase: "PRE_AWARD",
    stage: "ASSESSMENT",
    status: "APPLICATION_RECEIVED",
  },
  claim: {
    limits: { maximumClaims: 1, allowsPartialClaims: false },
    requiresApproval: false,
    requiresEvidence: false,
  },
};

const url = (code, clientRef) =>
  `/grant-admin/grants/${code}/applications/${clientRef}/claims/available-entitlements`;

describe("getAvailableEntitlementsRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(getAvailableEntitlementsRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("returns the available entitlement templates for code and clientRef", async () => {
    const code = "grant-1";
    const clientRef = "ref-1234";

    findAvailableEntitlementTemplatesUseCase.mockResolvedValue({
      entitlementTemplates: [template],
    });

    const result = await server.inject({
      method: "GET",
      url: url(code, clientRef),
    });

    expect(result.statusCode).toEqual(200);
    expect(findAvailableEntitlementTemplatesUseCase).toHaveBeenCalledWith({
      code,
      clientRef,
    });
    expect(result.result).toEqual({ entitlementTemplates: [template] });
  });

  it("returns an empty list when no template is available", async () => {
    findAvailableEntitlementTemplatesUseCase.mockResolvedValue({
      entitlementTemplates: [],
    });

    const result = await server.inject({
      method: "GET",
      url: url("grant-1", "ref-1234"),
    });

    expect(result.statusCode).toEqual(200);
    expect(result.result).toEqual({ entitlementTemplates: [] });
  });
});
