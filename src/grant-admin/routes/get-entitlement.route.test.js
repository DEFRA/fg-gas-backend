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
import {
  getChangeableEntitlement,
  listEntitlementsWithClaimCapacity,
  listSubmittedClaims,
} from "../../grants/services/claims.service.js";
import {
  getEntitlementOverview,
  getEntitlementTemplateDetails,
} from "../../grants/services/entitlement.service.js";
import { listClaimPaymentsUseCase } from "../../payments/use-cases/list-claim-payments.use-case.js";
import { prefetchOperatorRoles } from "../services/operator-roles.js";
import { getEntitlementRoute } from "./get-entitlement.route.js";

vi.mock("../../grants/services/entitlement.service.js");
vi.mock("../../grants/services/claims.service.js");
vi.mock("../../payments/use-cases/list-claim-payments.use-case.js");
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
  createdCount: 1,
  remainingCapacity: 0,
  fields: {
    totalHectares: {
      input: true,
      label: "Total area of eligible woodland",
      unitType: "decimal",
      decimalPlaces: 4,
      unit: "HA",
    },
  },
  maxEntitlements: 1,
  availableAt: [{ phase: "PRE_AWARD" }],
  claim: { limits: { maximumClaims: 1 } },
};

const { remainingCapacity: _remaining, ...answeredTemplate } = template;

const claimableEntitlement = {
  source: "persisted",
  claimCode: "ENT_CS_CAPITAL_PA3",
  name: "PA3 Woodland Management Plan entitlement",
  description: "The maximum eligible woodland area that can be claimed.",
  data: { totalHectares: { value: 12.5, decimalPlaces: 4 } },
  entitlementId: "entitlement-1",
  instanceNumber: 1,
  claim: { limits: { maximumClaims: 1 } },
};

const submittedClaim = {
  clientClaimRef: "WMP-EXAMPLE-002-C07",
  claimCode: "ENT_CS_CAPITAL_PA4",
  name: "PA4 entitlement",
  quantity: null,
  totalClaimAmountPence: 150000,
  requiresApproval: false,
  submittedAt: "2026-09-15T12:50:08.932Z",
};

const banner = {
  title: { text: "Elmwood Land Co", type: "string" },
  summary: {},
};

const code = "grant-1";
const clientRef = "ref-1234";
const entitlementId = "entitlement-1";

const url = (id = entitlementId) =>
  `/grant-admin/grants/${code}/applications/${clientRef}/claims/entitlements/${id}`;

const CLAIMS_ROLES = { allOf: ["ROLE_WMP_CLAIMS"], anyOf: [] };

describe("getEntitlementRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(getEntitlementRoute);
    await server.initialize();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getEntitlementOverview.mockResolvedValue({
      claimsPage: { details: { banner } },
      applicationContext: {},
      creationOptions: [],
      claimsRequiredRoles: null,
    });
    getEntitlementTemplateDetails.mockResolvedValue(template);
    listEntitlementsWithClaimCapacity.mockResolvedValue([
      { ...claimableEntitlement, canEdit: true },
    ]);
    getChangeableEntitlement.mockResolvedValue({
      ...claimableEntitlement,
      canEdit: true,
    });
    listSubmittedClaims.mockResolvedValue([submittedClaim]);
    listClaimPaymentsUseCase.mockResolvedValue(
      new Set([submittedClaim.clientClaimRef]),
    );
  });

  afterAll(async () => {
    await server.stop();
  });

  it("returns the entitlement and the template it was made under", async () => {
    const result = await server.inject({ method: "GET", url: url() });

    expect(result.statusCode).toEqual(200);
    expect(getEntitlementTemplateDetails).toHaveBeenCalledWith({
      code,
      clientRef,
      entitlementId,
    });
    expect(getChangeableEntitlement).toHaveBeenCalledWith({
      code,
      clientRef,
      entitlementId,
    });
    expect(result.result).toEqual({
      banner,
      availableEntitlements: [],
      claimableEntitlements: [{ ...claimableEntitlement, canEdit: true }],
      claimsRequiredRoles: null,
      access: "full",
      claims: [{ ...submittedClaim, paymentScheduled: true }],
      claimableEntitlement: { ...claimableEntitlement, canEdit: true },
      entitlementTemplate: answeredTemplate,
    });
  });

  it("passes on the refusal of an entitlement with a claim against it", async () => {
    getChangeableEntitlement.mockRejectedValue(Boom.conflict("claimed"));

    const result = await server.inject({ method: "GET", url: url() });

    expect(result.statusCode).toEqual(409);
  });

  it("returns 404 for an entitlement the application does not have", async () => {
    getEntitlementTemplateDetails.mockRejectedValue(
      Boom.notFound("no entitlement"),
    );

    const result = await server.inject({
      method: "GET",
      url: url("entitlement-unknown"),
    });

    expect(result.statusCode).toEqual(404);
  });

  describe("when the grant configures claims roles", () => {
    beforeEach(() => {
      getEntitlementOverview.mockResolvedValue({
        claimsPage: { details: { banner } },
        applicationContext: {},
        creationOptions: [],
        claimsRequiredRoles: CLAIMS_ROLES,
      });
    });

    const get = () => server.inject({ method: "GET", url: url() });

    it("answers full access to an operator holding them", async () => {
      findHeldRoles.mockResolvedValue(["ROLE_WMP_CLAIMS"]);

      const result = await get();

      expect(result.statusCode).toEqual(200);
      expect(result.result.access).toEqual("full");
      expect(findHeldRoles).toHaveBeenCalledTimes(1);
    });

    it("answers view-only access to an operator with other roles", async () => {
      findHeldRoles.mockResolvedValue(["ROLE_OTHER"]);

      const result = await get();

      expect(result.statusCode).toEqual(200);
      expect(result.result.access).toEqual("view-only");
    });

    it("refuses an operator with no roles with a 403", async () => {
      findHeldRoles.mockResolvedValue([]);

      expect((await get()).statusCode).toEqual(403);
    });

    it("answers 503 when Caseworking cannot say which roles the operator holds", async () => {
      findHeldRoles.mockRejectedValue(Boom.serverUnavailable());

      expect((await get()).statusCode).toEqual(503);
    });
  });

  it("does not ask Caseworking when the grant configures no claims roles", async () => {
    expect(
      (await server.inject({ method: "GET", url: url() })).statusCode,
    ).toEqual(200);
    expect(findHeldRoles).not.toHaveBeenCalled();
  });
});
