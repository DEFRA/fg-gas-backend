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
  getApplicationClaimsOverview,
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
  title: { text: "Example Woodland Holdings", type: "string" },
  summary: {
    sbi: { label: "SBI", text: "900000008", type: "string" },
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
    getApplicationClaimsOverview.mockResolvedValue({
      claimsPage: { details: { banner } },
      applicationContext: {},
      creationOptions: [template],
      claimsRequiredRoles: null,
      access: "full",
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

    getApplicationClaimsOverview.mockResolvedValue({
      claimsPage: { details: { banner } },
      applicationContext: {},
      creationOptions: [template],
      claimsRequiredRoles: null,
      access: "full",
    });
    getEntitlementCreationDetails.mockResolvedValue(template);
    listEntitlementsWithClaimCapacity.mockResolvedValue([]);

    const result = await server.inject({
      method: "GET",
      url: url(code, clientRef, claimCode),
    });

    expect(result.statusCode).toEqual(200);
    expect(getApplicationClaimsOverview).toHaveBeenCalledWith({
      code,
      clientRef,
      findHeldRoles,
    });
    expect(getEntitlementCreationDetails).toHaveBeenCalledWith({
      code,
      clientRef,
      claimCode,
      findHeldRoles,
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
    getApplicationClaimsOverview.mockResolvedValue({
      claimsPage: { details: { banner } },
      applicationContext: {},
      creationOptions: [],
      claimsRequiredRoles: null,
      access: "full",
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
    getApplicationClaimsOverview.mockResolvedValue({
      claimsPage: { details: { banner } },
      applicationContext: {},
      creationOptions: [],
      claimsRequiredRoles: null,
      access: "full",
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

  // Which roles may see the claims page, and which may also create from it, is
  // Grants' to decide; the route only hands over the lookup and passes on the
  // outcome.
  describe("access by claims roles", () => {
    const get = () =>
      server.inject({
        method: "GET",
        url: url("grant-1", "ref-1234", template.claimCode),
      });

    beforeEach(() => {
      getApplicationClaimsOverview.mockResolvedValue({
        claimsPage: { details: { banner } },
        applicationContext: {},
        creationOptions: [template],
        claimsRequiredRoles: CLAIMS_ROLES,
        access: "full",
      });
      getEntitlementCreationDetails.mockResolvedValue(template);
      listEntitlementsWithClaimCapacity.mockResolvedValue([]);
    });

    it("answers the access Grants decided, with the roles it was decided on", async () => {
      const result = await get();

      expect(result.statusCode).toEqual(200);
      expect(result.result.access).toEqual("full");
      expect(result.result.claimsRequiredRoles).toEqual(CLAIMS_ROLES);
      expect(findHeldRoles).not.toHaveBeenCalled();
    });

    it.each([
      ["the overview", getApplicationClaimsOverview],
      ["the creation details", getEntitlementCreationDetails],
    ])("passes on %s refusing the operator with a 403", async (_, read) => {
      read.mockRejectedValue(Boom.forbidden());

      expect((await get()).statusCode).toEqual(403);
    });

    it("passes on a failure to determine the operator's roles with a 503", async () => {
      getEntitlementCreationDetails.mockRejectedValue(Boom.serverUnavailable());

      expect((await get()).statusCode).toEqual(503);
    });
  });
});
