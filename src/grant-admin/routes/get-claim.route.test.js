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
import { listClaimableEntitlements } from "../../grants/services/claims.service.js";
import {
  getEntitlementCreationDetails,
  getEntitlementOverview,
} from "../../grants/services/entitlement.service.js";
import { getClaimRoute } from "./get-claim.route.js";

vi.mock("../../grants/services/entitlement.service.js");
vi.mock("../../grants/services/claims.service.js");
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

  it("returns the claims data and the template for the claim code", async () => {
    const code = "grant-1";
    const clientRef = "ref-1234";
    const claimCode = template.claimCode;

    getEntitlementOverview.mockResolvedValue({
      claimsPage: { details: { banner } },
      applicationContext: {},
      creationOptions: [template],
    });
    getEntitlementCreationDetails.mockResolvedValue(template);
    listClaimableEntitlements.mockResolvedValue([]);

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
    expect(listClaimableEntitlements).toHaveBeenCalledWith({ code, clientRef });
    expect(result.result).toEqual({
      banner,
      availableEntitlements: [template],
      claimableEntitlements: [],
      claims: [],
      entitlementTemplate: template,
    });
  });

  it("returns 409 when the claim code already has an entitlement", async () => {
    getEntitlementOverview.mockResolvedValue({
      claimsPage: { details: { banner } },
      applicationContext: {},
      creationOptions: [],
    });
    getEntitlementCreationDetails.mockRejectedValue(
      Boom.conflict("already exists"),
    );
    listClaimableEntitlements.mockResolvedValue([]);

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
    });
    getEntitlementCreationDetails.mockRejectedValue(
      Boom.notFound("not available"),
    );
    listClaimableEntitlements.mockResolvedValue([]);

    const result = await server.inject({
      method: "GET",
      url: url("grant-1", "ref-1234", "ENT_UNKNOWN"),
    });

    expect(result.statusCode).toEqual(404);
  });
});
