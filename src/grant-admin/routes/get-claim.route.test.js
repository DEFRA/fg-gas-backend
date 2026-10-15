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
import { listEntitlementsWithClaimCapacity } from "../../grants/services/claims.service.js";
import {
  getEntitlementCreationDetails,
  getEntitlementOverview,
} from "../../grants/services/entitlement.service.js";
import { prefetchOperatorRoles } from "../services/operator-roles.js";
import { getClaimRoute } from "./get-claim.route.js";

vi.mock("../../grants/services/entitlement.service.js");
vi.mock("../../grants/services/claims.service.js");
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

const url = (code, clientRef, claimCode) =>
  `/grant-admin/grants/${code}/applications/${clientRef}/claims/${claimCode}`;

const CLAIMS_ROLES = { allOf: ["ROLE_WMP_CLAIMS"], anyOf: [] };

describe("getClaimRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(getClaimRoute);
    await server.initialize();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await server.stop();
  });

  // The add-claimable-item view shows no submitted Claims, so reading them -
  // and reaching into Payments to price them - would be work thrown away on
  // every form load and every validation error.
  it("reads neither the submitted Claims nor their Payments", async () => {
    getEntitlementOverview.mockResolvedValue({
      claimsPage: { details: { banner } },
      applicationContext: {},
      creationOptions: [template],
      claimsRequiredRoles: null,
    });
    getEntitlementCreationDetails.mockResolvedValue(template);
    listEntitlementsWithClaimCapacity.mockResolvedValue([]);

    const result = await server.inject({
      method: "GET",
      url: url("grant-1", "ref-1234", template.claimCode),
    });

    expect(result.statusCode).toEqual(200);
    expect(result.result.claims).toBeUndefined();
  });

  it("returns the claims data and the template for the claim code", async () => {
    const code = "grant-1";
    const clientRef = "ref-1234";
    const claimCode = template.claimCode;

    getEntitlementOverview.mockResolvedValue({
      claimsPage: { details: { banner } },
      applicationContext: {},
      creationOptions: [template],
      claimsRequiredRoles: null,
    });
    getEntitlementCreationDetails.mockResolvedValue(template);
    listEntitlementsWithClaimCapacity.mockResolvedValue([]);

    const result = await server.inject({
      method: "GET",
      url: url(code, clientRef, claimCode),
    });

    expect(result.statusCode).toEqual(200);
    expect(getEntitlementOverview).toHaveBeenCalledWith({
      code,
      clientRef,
    });
    expect(getEntitlementCreationDetails).toHaveBeenCalledWith({
      code,
      clientRef,
      claimCode,
    });
    expect(listEntitlementsWithClaimCapacity).toHaveBeenCalledWith({
      code,
      clientRef,
    });
    expect(result.result).toEqual({
      banner,
      availableEntitlements: [template],
      claimableEntitlements: [],
      claimsRequiredRoles: null,
      access: "full",
      entitlementTemplate: template,
    });
  });

  it("returns 409 when the claim code already has an entitlement", async () => {
    getEntitlementOverview.mockResolvedValue({
      claimsPage: { details: { banner } },
      applicationContext: {},
      creationOptions: [],
      claimsRequiredRoles: null,
    });
    getEntitlementCreationDetails.mockRejectedValue(
      Boom.conflict("already exists"),
    );
    listEntitlementsWithClaimCapacity.mockResolvedValue([]);

    const result = await server.inject({
      method: "GET",
      url: url("grant-1", "ref-1234", template.claimCode),
    });

    expect(result.statusCode).toEqual(409);
  });

  it("returns 404 when the claim code is not available", async () => {
    getEntitlementOverview.mockResolvedValue({
      claimsPage: { details: { banner } },
      applicationContext: {},
      creationOptions: [],
      claimsRequiredRoles: null,
    });
    getEntitlementCreationDetails.mockRejectedValue(
      Boom.notFound("not available"),
    );
    listEntitlementsWithClaimCapacity.mockResolvedValue([]);

    const result = await server.inject({
      method: "GET",
      url: url("grant-1", "ref-1234", "ENT_UNKNOWN"),
    });

    expect(result.statusCode).toEqual(404);
  });

  describe("access by claims roles", () => {
    const withClaimsRoles = (claimsRequiredRoles) => {
      getEntitlementOverview.mockResolvedValue({
        claimsPage: { details: { banner } },
        applicationContext: {},
        creationOptions: [template],
        claimsRequiredRoles,
      });
      getEntitlementCreationDetails.mockResolvedValue(template);
      listEntitlementsWithClaimCapacity.mockResolvedValue([]);
    };

    const get = () =>
      server.inject({
        method: "GET",
        url: url("grant-1", "ref-1234", template.claimCode),
      });

    it("does not ask Caseworking when the grant configures none", async () => {
      withClaimsRoles(null);

      expect((await get()).statusCode).toEqual(200);
      expect(findHeldRoles).not.toHaveBeenCalled();
    });

    it("answers an operator holding them", async () => {
      withClaimsRoles(CLAIMS_ROLES);
      findHeldRoles.mockResolvedValue(["ROLE_WMP_CLAIMS"]);

      const result = await get();

      expect(result.statusCode).toEqual(200);
      expect(result.result.access).toEqual("full");
      expect(findHeldRoles).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["other roles", ["ROLE_OTHER"]],
      ["no roles", []],
    ])("refuses an operator with %s with a 403", async (_, roles) => {
      withClaimsRoles(CLAIMS_ROLES);
      findHeldRoles.mockResolvedValue(roles);

      expect((await get()).statusCode).toEqual(403);
    });

    it("answers 503 when Caseworking cannot say which roles the operator holds", async () => {
      withClaimsRoles(CLAIMS_ROLES);
      findHeldRoles.mockRejectedValue(Boom.serverUnavailable());

      expect((await get()).statusCode).toEqual(503);
    });
  });
});
