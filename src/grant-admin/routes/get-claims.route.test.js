import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getEntitlementOverview } from "../../grants/services/entitlement.service.js";
import { getClaimsRoute } from "./get-claims.route.js";

vi.mock("../../grants/services/entitlement.service.js");
vi.mock("../../common/logger.js");

const template = {
  claimCode: "ENT_CS_CAPITAL_PA3",
  name: "PA3 Woodland Management Plan entitlement",
  description: "The maximum eligible woodland area that can be claimed.",
  materialised: false,
  createdCount: 0,
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
  availableAt: [
    {
      phase: "PRE_AWARD",
      stage: "ASSESSMENT",
      status: "APPLICATION_RECEIVED",
    },
  ],
  claim: {
    limits: { maximumClaims: 1, allowsPartialClaims: false },
    requiresApproval: false,
    requiresEvidence: false,
  },
};

const banner = {
  title: { text: "Elmwood Land Co", type: "string" },
  summary: {
    sbi: { label: "SBI", text: "113598882", type: "string" },
  },
};

const url = (code, clientRef) =>
  `/grant-admin/grants/${code}/applications/${clientRef}/claims`;

describe("getClaimsRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(getClaimsRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("returns the claims data for code and clientRef", async () => {
    const code = "grant-1";
    const clientRef = "ref-1234";

    getEntitlementOverview.mockResolvedValue({
      claimsPage: { details: { banner } },
      applicationContext: {},
      creationOptions: [template],
      entitlements: [],
    });

    const result = await server.inject({
      method: "GET",
      url: url(code, clientRef),
    });

    expect(result.statusCode).toEqual(200);
    expect(getEntitlementOverview).toHaveBeenCalledWith({
      code,
      clientRef,
    });
    expect(result.result).toEqual({
      banner,
      availableEntitlements: [template],
      claimableEntitlements: [],
      claims: [],
    });
  });

  it("returns empty lists when nothing is available", async () => {
    getEntitlementOverview.mockResolvedValue({
      claimsPage: { details: { banner } },
      applicationContext: {},
      creationOptions: [],
      entitlements: [],
    });

    const result = await server.inject({
      method: "GET",
      url: url("grant-1", "ref-1234"),
    });

    expect(result.statusCode).toEqual(200);
    expect(result.result).toEqual({
      banner,
      availableEntitlements: [],
      claimableEntitlements: [],
      claims: [],
    });
  });
});
