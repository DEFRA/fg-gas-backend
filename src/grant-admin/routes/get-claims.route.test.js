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
  listEntitlementsWithClaimCapacity,
  listSubmittedClaims,
} from "../../grants/services/claims.service.js";
import { getEntitlementOverview } from "../../grants/services/entitlement.service.js";
import { listClaimPaymentsUseCase } from "../../payments/use-cases/list-claim-payments.use-case.js";
import { prefetchOperatorRoles } from "../services/operator-roles.js";
import { getClaimsRoute } from "./get-claims.route.js";

vi.mock("../../grants/services/entitlement.service.js");
vi.mock("../../grants/services/claims.service.js");
vi.mock("../../payments/use-cases/list-claim-payments.use-case.js");
vi.mock("../../common/logger.js");
vi.mock("../services/operator-roles.js");

const findHeldRoles = vi.fn();

beforeEach(() => {
  prefetchOperatorRoles.mockReturnValue(findHeldRoles);
});

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
    sbi: { label: "SBI", text: "900000008", type: "string" },
  },
};

const claimableEntitlement = {
  source: "persisted",
  claimCode: "ENT_CS_CAPITAL_PA3",
  name: "PA3 Woodland Management Plan entitlement",
  description: "The maximum eligible woodland area that can be claimed.",
  data: {},
  entitlementId: "entitlement-1",
  instanceNumber: 1,
  claim: {
    limits: { maximumClaims: 1, allowsPartialClaims: false },
    requiresApproval: false,
    requiresEvidence: false,
  },
};

const submittedClaim = {
  clientClaimRef: "WMP-EXAMPLE-002-C07",
  claimCode: "ENT_CS_CAPITAL_PA3",
  name: "PA3 Woodland Management Plan entitlement",
  quantity: { value: 23, unit: "HA" },
  totalClaimAmountPence: 150000,
  requiresApproval: false,
  submittedAt: "2026-09-15T12:50:08.932Z",
};

const CLAIMS_ROLES = { allOf: ["ROLE_WMP_CLAIMS"], anyOf: [] };

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
      claimsRequiredRoles: null,
    });
    listEntitlementsWithClaimCapacity.mockResolvedValue([
      { ...claimableEntitlement, canEdit: true },
    ]);
    listSubmittedClaims.mockResolvedValue([]);
    listClaimPaymentsUseCase.mockResolvedValue(new Set());

    const result = await server.inject({
      method: "GET",
      url: url(code, clientRef),
    });

    expect(result.statusCode).toEqual(200);
    expect(getEntitlementOverview).toHaveBeenCalledWith({
      code,
      clientRef,
    });
    expect(listEntitlementsWithClaimCapacity).toHaveBeenCalledWith({
      code,
      clientRef,
    });
    expect(result.result).toEqual({
      banner,
      availableEntitlements: [template],
      claimableEntitlements: [{ ...claimableEntitlement, canEdit: true }],
      claimsRequiredRoles: null,
      access: "full",
      claims: [],
    });
  });

  it("returns empty lists when nothing is available", async () => {
    getEntitlementOverview.mockResolvedValue({
      claimsPage: { details: { banner } },
      applicationContext: {},
      creationOptions: [],
      claimsRequiredRoles: null,
    });
    listEntitlementsWithClaimCapacity.mockResolvedValue([]);
    listSubmittedClaims.mockResolvedValue([]);
    listClaimPaymentsUseCase.mockResolvedValue(new Set());

    const result = await server.inject({
      method: "GET",
      url: url("grant-1", "ref-1234"),
    });

    expect(result.statusCode).toEqual(200);
    expect(result.result).toEqual({
      banner,
      availableEntitlements: [],
      claimableEntitlements: [],
      claimsRequiredRoles: null,
      access: "full",
      claims: [],
    });
  });

  it("returns a submitted claim with its payment state", async () => {
    getEntitlementOverview.mockResolvedValue({
      claimsPage: { details: { banner } },
      applicationContext: {},
      creationOptions: [],
      claimsRequiredRoles: null,
    });
    listEntitlementsWithClaimCapacity.mockResolvedValue([]);
    listSubmittedClaims.mockResolvedValue([submittedClaim]);
    listClaimPaymentsUseCase.mockResolvedValue(
      new Set([submittedClaim.clientClaimRef]),
    );

    const result = await server.inject({
      method: "GET",
      url: url("grant-1", "ref-1234"),
    });

    expect(result.statusCode).toEqual(200);
    expect(result.result.claims).toEqual([
      { ...submittedClaim, paymentScheduled: true },
    ]);
  });

  // The response schema is the contract the admin UI reads, so a claim that
  // does not satisfy it must fail here rather than reach the page.
  it("answers a claim awaiting its Payment with an unscheduled payment state", async () => {
    getEntitlementOverview.mockResolvedValue({
      claimsPage: { details: { banner } },
      applicationContext: {},
      creationOptions: [],
      claimsRequiredRoles: null,
    });
    listEntitlementsWithClaimCapacity.mockResolvedValue([]);
    listSubmittedClaims.mockResolvedValue([
      { ...submittedClaim, requiresApproval: true, quantity: null },
    ]);
    listClaimPaymentsUseCase.mockResolvedValue(new Set());

    const result = await server.inject({
      method: "GET",
      url: url("grant-1", "ref-1234"),
    });

    expect(result.statusCode).toEqual(200);
    expect(result.result.claims).toEqual([
      {
        ...submittedClaim,
        requiresApproval: true,
        quantity: null,
        paymentScheduled: false,
      },
    ]);
  });

  describe("when the grant configures claims roles", () => {
    const withClaimsRoles = () => {
      getEntitlementOverview.mockResolvedValue({
        claimsPage: { details: { banner } },
        applicationContext: {},
        creationOptions: [],
        claimsRequiredRoles: CLAIMS_ROLES,
      });
      listEntitlementsWithClaimCapacity.mockResolvedValue([]);
      listSubmittedClaims.mockResolvedValue([]);
      listClaimPaymentsUseCase.mockResolvedValue(new Set());
    };

    const get = () =>
      server.inject({ method: "GET", url: url("grant-1", "ref-1234") });

    it("does not ask Caseworking when the grant configures none", async () => {
      getEntitlementOverview.mockResolvedValue({
        claimsPage: { details: { banner } },
        applicationContext: {},
        creationOptions: [],
        claimsRequiredRoles: null,
      });
      listEntitlementsWithClaimCapacity.mockResolvedValue([]);
      listSubmittedClaims.mockResolvedValue([]);
      listClaimPaymentsUseCase.mockResolvedValue(new Set());

      expect((await get()).statusCode).toEqual(200);
      expect(findHeldRoles).not.toHaveBeenCalled();
    });

    it("answers full access to an operator holding them", async () => {
      withClaimsRoles();
      findHeldRoles.mockResolvedValue(["ROLE_WMP_CLAIMS"]);

      const result = await get();

      expect(result.statusCode).toEqual(200);
      expect(result.result.access).toEqual("full");
      expect(result.result.claimsRequiredRoles).toEqual(CLAIMS_ROLES);
      expect(findHeldRoles).toHaveBeenCalledTimes(1);
    });

    it("answers view-only access to an operator with other roles", async () => {
      withClaimsRoles();
      findHeldRoles.mockResolvedValue(["ROLE_OTHER"]);

      const result = await get();

      expect(result.statusCode).toEqual(200);
      expect(result.result.access).toEqual("view-only");
    });

    it("refuses an operator with no roles with a 403", async () => {
      withClaimsRoles();
      findHeldRoles.mockResolvedValue([]);

      expect((await get()).statusCode).toEqual(403);
    });

    it("answers 503 when Caseworking cannot say which roles the operator holds", async () => {
      withClaimsRoles();
      findHeldRoles.mockRejectedValue(Boom.serverUnavailable());

      expect((await get()).statusCode).toEqual(503);
    });
  });
});
