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
import { withRequestContext } from "../../common/get-request-context.js";
import { logger } from "../../common/logger.js";
import {
  listEntitlementsWithClaimCapacity,
  listSubmittedClaims,
} from "../../grants/services/claims.service.js";
import {
  createEntitlement,
  getEntitlementOverview,
} from "../../grants/services/entitlement.service.js";
import { listClaimPaymentsUseCase } from "../../payments/use-cases/list-claim-payments.use-case.js";
import { findCwUserRoles } from "../repositories/cw-users.repository.js";
import { setAuditActor } from "../set-audit-actor.js";
import { createEntitlementRoute } from "./create-entitlement.route.js";
import { getClaimsRoute } from "./get-claims.route.js";

vi.mock("../../common/logger.js");
vi.mock("../../grants/services/entitlement.service.js");
vi.mock("../../grants/services/claims.service.js");
vi.mock("../../payments/use-cases/list-claim-payments.use-case.js");
vi.mock("../repositories/cw-users.repository.js");

const ACTOR_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const CLAIMS_ROLES = { allOf: ["ROLE_WMP_CLAIMS"], anyOf: [] };
const CLAIMS_URL =
  "/grant-admin/grants/woodland/applications/wmp-abc-123/claims";
const ENTITLEMENTS_URL = `${CLAIMS_URL}/entitlements`;

const overview = (claimsRequiredRoles) => ({
  claimsPage: {
    details: { banner: { title: { text: "Elmwood Land Co", type: "string" } } },
  },
  applicationContext: {},
  creationOptions: [],
  claimsRequiredRoles,
});

const createPayload = {
  clientRef: "wmp-abc-123",
  grantCode: "woodland",
  claimCode: "ENT_CS_CAPITAL_PA3",
  data: { totalHectares: { value: 455000 } },
};

// The request context and the operator on it, wired as the server and the
// grant-admin plugin wire them.
const withContext = (server) => {
  server.ext("onRequest", (request, h) => {
    const context = {};
    for (const cycle of ["_lifecycle", "_postCycle"]) {
      const fn = request[cycle].bind(request);
      request[cycle] = () => withRequestContext(context, fn);
    }
    return h.continue;
  });
  server.ext("onPostAuth", setAuditActor);
};

const deferred = () => {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });

  return { promise, resolve: release };
};

describe("claims routes ask Caseworking for the operator's roles", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    withContext(server);
    server.route([getClaimsRoute, createEntitlementRoute]);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    getEntitlementOverview.mockResolvedValue(overview(CLAIMS_ROLES));
    listEntitlementsWithClaimCapacity.mockResolvedValue([]);
    listSubmittedClaims.mockResolvedValue([]);
    listClaimPaymentsUseCase.mockResolvedValue(new Set());
    createEntitlement.mockResolvedValue({ id: "entitlement-1" });
    findCwUserRoles.mockResolvedValue({ roles: ["ROLE_WMP_CLAIMS"] });
  });

  const getClaims = (headers = { "x-actor-id": ACTOR_ID }) =>
    server.inject({ method: "GET", url: CLAIMS_URL, headers });

  it("looks up the operator named by x-actor-id", async () => {
    const response = await getClaims();

    expect(response.statusCode).toBe(200);
    expect(response.result.access).toBe("full");
    expect(findCwUserRoles).toHaveBeenCalledExactlyOnceWith(ACTOR_ID);
  });

  it("refuses a restricted grant without asking Caseworking when no operator is named", async () => {
    const response = await getClaims({});

    expect(response.statusCode).toBe(403);
    expect(findCwUserRoles).not.toHaveBeenCalled();
  });

  it.each([
    ["the claims read", () => getClaims()],
    [
      "an entitlement creation",
      () =>
        server.inject({
          method: "POST",
          url: ENTITLEMENTS_URL,
          headers: { "x-actor-id": ACTOR_ID },
          payload: createPayload,
        }),
    ],
  ])(
    "asks Caseworking while %s is still reading the grant",
    async (_, send) => {
      const read = deferred();
      getEntitlementOverview.mockReturnValue(read.promise);

      const response = send();
      await vi.waitFor(() => expect(getEntitlementOverview).toHaveBeenCalled());

      expect(findCwUserRoles).toHaveBeenCalledWith(ACTOR_ID);

      read.resolve(overview(CLAIMS_ROLES));
      expect((await response).statusCode).toBeLessThan(300);
      expect(findCwUserRoles).toHaveBeenCalledTimes(1);
    },
  );

  it("answers 503 with an errorCode when Caseworking cannot say", async () => {
    findCwUserRoles.mockResolvedValue({
      roles: null,
      failure: "Caseworking is unavailable (HTTP 500)",
    });

    const response = await getClaims();

    expect(response.statusCode).toBe(503);
    expect(response.result.errorCode).toBe("CASEWORKING_ROLES_UNAVAILABLE");
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      "Operator roles could not be determined: Caseworking is unavailable (HTTP 500)",
    );
  });

  it("neither needs nor warns about Caseworking for an unrestricted grant", async () => {
    getEntitlementOverview.mockResolvedValue(overview(null));
    findCwUserRoles.mockResolvedValue({
      roles: null,
      failure: "Caseworking is not configured",
    });

    const response = await getClaims();

    expect(response.statusCode).toBe(200);
    expect(response.result.access).toBe("full");
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
