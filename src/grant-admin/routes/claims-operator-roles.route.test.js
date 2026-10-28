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
  getApplicationClaimsOverview,
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
const CLAIMS_URL =
  "/grant-admin/grants/woodland/applications/wmp-abc-123/claims";
const ENTITLEMENTS_URL = `${CLAIMS_URL}/entitlements`;

const overview = {
  claimsPage: {
    details: {
      banner: { title: { text: "Example Woodland Holdings", type: "string" } },
    },
  },
  applicationContext: {},
  creationOptions: [],
  claimsRequiredRoles: null,
  access: "full",
};

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

// Grants decides what the roles allow and asks for them only when the grant
// requires some. Here the services stand in for that: a service that asks
// calls the lookup it was handed.
const readAsking =
  (answer) =>
  async ({ findHeldRoles }) => {
    await findHeldRoles();

    return answer;
  };

const commandAsking = (answer) => async (_command, findHeldRoles) => {
  await findHeldRoles();

  return answer;
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
    getApplicationClaimsOverview.mockImplementation(readAsking(overview));
    listEntitlementsWithClaimCapacity.mockResolvedValue([]);
    listSubmittedClaims.mockResolvedValue([]);
    listClaimPaymentsUseCase.mockResolvedValue(new Set());
    createEntitlement.mockImplementation(
      commandAsking({ id: "entitlement-1" }),
    );
    findCwUserRoles.mockResolvedValue({ roles: ["ROLE_WMP_CLAIMS"] });
  });

  const getClaims = (headers = { "x-actor-id": ACTOR_ID }) =>
    server.inject({ method: "GET", url: CLAIMS_URL, headers });

  const createOne = () =>
    server.inject({
      method: "POST",
      url: ENTITLEMENTS_URL,
      headers: { "x-actor-id": ACTOR_ID },
      payload: createPayload,
    });

  it("looks up the operator named by x-actor-id", async () => {
    const response = await getClaims();

    expect(response.statusCode).toBe(200);
    expect(findCwUserRoles).toHaveBeenCalledExactlyOnceWith(ACTOR_ID);
  });

  it("answers no roles, without asking Caseworking, when no operator is named", async () => {
    let held;
    getApplicationClaimsOverview.mockImplementation(
      async ({ findHeldRoles }) => {
        held = await findHeldRoles();

        return overview;
      },
    );

    const response = await getClaims({});

    expect(response.statusCode).toBe(200);
    expect(held).toEqual([]);
    expect(findCwUserRoles).not.toHaveBeenCalled();
  });

  it.each([
    ["the claims read", getApplicationClaimsOverview, getClaims],
    ["an entitlement creation", createEntitlement, createOne],
  ])(
    "asks Caseworking while %s is still reading the grant",
    async (_, service, send) => {
      const read = deferred();
      service.mockReturnValue(read.promise);

      const response = send();
      await vi.waitFor(() => expect(service).toHaveBeenCalled());

      expect(findCwUserRoles).toHaveBeenCalledWith(ACTOR_ID);

      read.resolve(service === createEntitlement ? { id: "e" } : overview);
      expect((await response).statusCode).toBeLessThan(300);
      expect(findCwUserRoles).toHaveBeenCalledTimes(1);
    },
  );

  it("asks Caseworking once however often Grants asks for the roles", async () => {
    createEntitlement.mockImplementation(async (_command, findHeldRoles) => {
      await findHeldRoles();
      await findHeldRoles();

      return { id: "entitlement-1" };
    });

    expect((await createOne()).statusCode).toBe(201);
    expect(findCwUserRoles).toHaveBeenCalledTimes(1);
  });

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

  it("neither needs nor warns about Caseworking when Grants does not ask for the roles", async () => {
    getApplicationClaimsOverview.mockResolvedValue(overview);
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
