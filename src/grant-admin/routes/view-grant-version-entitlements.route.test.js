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
import { grantVersionNotFound } from "../services/grant-not-found.js";
import { viewGrantVersionPageUseCase } from "../use-cases/view-grant-version-page.use-case.js";
import { viewGrantVersionEntitlementsRoute } from "./view-grant-version-entitlements.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/view-grant-version-page.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const HEADER = {
  code: "woodland",
  version: "2.0.0",
  status: "draft",
  receivedAt: "2026-10-15T10:04:00.000Z",
  s3Bucket: "config-broker-local",
  files: {
    grant: { stored: true, fetchStatus: "fetched" },
    payment: { stored: true, fetchStatus: "fetched" },
  },
  versions: [
    {
      version: "2.0.0",
      status: "draft",
      receivedAt: "2026-10-15T10:04:00.000Z",
    },
  ],
  counterpart: null,
};

const ACCEPTED = {
  phase: "POST_AWARD",
  stage: "AGREEMENT",
  status: "ACCEPTED",
};

const PAGE = {
  header: HEADER,
  entitlements: {
    entitlementTemplates: [
      {
        claimCode: "MAINTENANCE",
        name: "Maintenance payment",
        materialised: false,
        maxEntitlements: 10,
        availableAt: [ACCEPTED],
        fields: {
          hectares: {
            input: true,
            label: "Area maintained this year",
            unitType: "decimal",
            decimalPlaces: 2,
            unit: "ha",
            minValue: 0.1,
            maxValue: null,
          },
        },
        claim: {
          claimableAt: [{ phase: "POST_AWARD", stage: "AGREEMENT" }],
          limits: { maximumClaims: 10, allowsPartialClaims: false },
          requiresApproval: false,
          requiresEvidence: true,
        },
      },
    ],
    claims: {
      onClaimApproval: {
        currentPosition: ACCEPTED,
        targetPosition: { ...ACCEPTED, status: "CLAIMS_COMPLETE" },
      },
      requiredRoles: { allOf: ["Grants.Claims.Read"], anyOf: [] },
    },
    statusNames: { "POST_AWARD:AGREEMENT:ACCEPTED": "Accepted" },
    payment: { code: "woodland", sbi: "$.agreement.identifiers.sbi" },
  },
  sourceErrors: [],
  sectionErrors: [],
};

describe("viewGrantVersionEntitlementsRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(viewGrantVersionEntitlementsRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    viewGrantVersionPageUseCase.mockResolvedValue(PAGE);
  });

  const get = (headers = HEADERS, version = "2.0.0", code = "woodland") =>
    server.inject({
      method: "GET",
      url: `/grant-admin/grants/${code}/versions/${version}/entitlements`,
      headers,
    });

  it("answers the templates, claims and payment definition, never to be stored, in one use-case call", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(PAGE);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(viewGrantVersionPageUseCase).toHaveBeenCalledWith({
      code: "woodland",
      version: "2.0.0",
      tab: "entitlements",
      caller: "fg-grants-platform-admin",
    });
  });

  it("answers a grant file not stored as null", async () => {
    const notStored = {
      ...PAGE,
      header: {
        ...HEADER,
        files: { grant: { stored: false, fetchStatus: "pending" } },
      },
      entitlements: null,
    };
    viewGrantVersionPageUseCase.mockResolvedValue(notStored);

    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(notStored);
  });

  it("answers no templates, no claims and no payment definition", async () => {
    const empty = {
      ...PAGE,
      entitlements: { entitlementTemplates: [], claims: null, payment: null },
    };
    viewGrantVersionPageUseCase.mockResolvedValue(empty);

    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(empty);
  });

  it("answers a too-large section as null beside its section error", async () => {
    const tooLarge = {
      ...PAGE,
      entitlements: null,
      sectionErrors: [
        { section: "entitlements", message: "too large to show" },
      ],
    };
    viewGrantVersionPageUseCase.mockResolvedValue(tooLarge);

    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(tooLarge);
  });

  it("refuses a section without its payment key", async () => {
    const { payment, ...withoutPayment } = PAGE.entitlements;
    viewGrantVersionPageUseCase.mockResolvedValue({
      ...PAGE,
      entitlements: withoutPayment,
    });

    expect((await get()).statusCode).toBe(500);
  });

  it("answers 404 GRANT_VERSION_NOT_FOUND for an unknown version", async () => {
    viewGrantVersionPageUseCase.mockRejectedValue(grantVersionNotFound());

    const response = await get();

    expect(response.statusCode).toBe(404);
    expect(response.result.reason).toBe("GRANT_VERSION_NOT_FOUND");
  });

  it.each([
    ["no x-actor", { "x-actor-id": OID }],
    ["no x-actor-id", { "x-actor": "Jo" }],
  ])("refuses %s with 400", async (_name, headers) => {
    expect((await get(headers)).statusCode).toBe(400);
    expect(viewGrantVersionPageUseCase).not.toHaveBeenCalled();
  });

  it.each([
    ["a version that is not semver", "2.0", "woodland"],
    ["a code outside the code alphabet", "2.0.0", "Woodland"],
  ])("refuses %s with 400", async (_name, version, code) => {
    expect((await get(HEADERS, version, code)).statusCode).toBe(400);
    expect(viewGrantVersionPageUseCase).not.toHaveBeenCalled();
  });
});
