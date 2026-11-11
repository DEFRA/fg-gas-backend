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
import { Application } from "../../grants/models/application.js";
import { Grant } from "../../grants/models/grant.js";
import { findByClientRefAndCode } from "../../grants/repositories/application.repository.js";
import { findByApplication } from "../../grants/repositories/claim.repository.js";
import { findLatestForMajor } from "../../grants/repositories/config-version.repository.js";
import { findExistingEntitlements } from "../../grants/repositories/entitlement.repository.js";
import { findByCode } from "../../grants/repositories/grant.repository.js";
import { resolveAndFetchGrant } from "../../grants/services/resolve-config-version.service.js";
import { findClaimPaymentClientClaimRefs } from "../../payments/repositories/payment.repository.js";
import { _clearGrantDefinitionCache } from "../../grants/use-cases/resolve-current-grant.use-case.js";
import { findCwUserRoles } from "../repositories/cw-users.repository.js";
import { setAuditActor } from "../set-audit-actor.js";
import { getClaimsRoute } from "./get-claims.route.js";

vi.mock("../../common/logger.js");
vi.mock("../../grants/repositories/application.repository.js");
vi.mock("../../grants/repositories/claim.repository.js");
vi.mock("../../grants/repositories/config-version.repository.js");
vi.mock("../../grants/repositories/entitlement.repository.js");
vi.mock("../../grants/repositories/grant.repository.js");
vi.mock("../../grants/services/resolve-config-version.service.js");
vi.mock("../../payments/repositories/payment.repository.js");
vi.mock("../repositories/cw-users.repository.js");

const code = "woodland";
const clientRef = "wmp-abc-123";
const actorId = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const requiredRoles = { allOf: ["ROLE_WMP_CLAIMS"], anyOf: [] };

describe("claims permissions with real services", () => {
  let server;
  let grant;

  beforeAll(async () => {
    server = hapi.server();
    // Match the server request context and the grant-admin actor hook.
    server.ext("onRequest", (request, h) => {
      const context = {};
      for (const cycle of ["_lifecycle", "_postCycle"]) {
        const fn = request[cycle].bind(request);
        request[cycle] = () => withRequestContext(context, fn);
      }
      return h.continue;
    });
    server.ext("onPostAuth", setAuditActor);
    server.route(getClaimsRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    _clearGrantDefinitionCache();
    grant = new Grant({
      code,
      metadata: {},
      actions: [],
      phases: [],
      claims: { requiredRoles },
      pages: {
        claims: {
          details: {
            banner: { title: { text: "Claims", type: "string" } },
          },
        },
      },
    });
    findLatestForMajor.mockResolvedValue({ version: "1.0.0" });
    resolveAndFetchGrant.mockResolvedValue({
      grant,
      resolvedVersion: "1.0.0",
      definitionSource: "mongodb",
    });
    findByCode.mockResolvedValue(grant);
    findByClientRefAndCode.mockResolvedValue(
      new Application({
        code,
        clientRef,
        phases: [],
        originalConfigVersion: "1.0.0",
      }),
    );
    findExistingEntitlements.mockResolvedValue([]);
    findByApplication.mockResolvedValue([]);
    findClaimPaymentClientClaimRefs.mockResolvedValue(new Set());
    findCwUserRoles.mockResolvedValue({ roles: ["ROLE_WMP_CLAIMS"] });
  });

  const getClaims = (headers = {}) =>
    server.inject({
      method: "GET",
      url: `/grant-admin/grants/${code}/applications/${clientRef}/claims`,
      headers,
    });

  it("returns 403 for a restricted grant without x-actor-id, without calling Caseworking", async () => {
    const response = await getClaims();

    expect(response.statusCode).toBe(403);
    expect(findCwUserRoles).not.toHaveBeenCalled();
  });

  it("allows an operator holding the configured grant roles", async () => {
    const response = await getClaims({ "x-actor-id": actorId });

    expect(response.statusCode).toBe(200);
    expect(response.result).toMatchObject({
      access: "full",
      claimsRequiredRoles: requiredRoles,
    });
    expect(findCwUserRoles).toHaveBeenCalledExactlyOnceWith(actorId);
  });

  it("allows an unrestricted grant without x-actor-id or calling Caseworking", async () => {
    grant.claims = undefined;

    const response = await getClaims();

    expect(response.statusCode).toBe(200);
    expect(response.result.access).toBe("full");
    expect(findCwUserRoles).not.toHaveBeenCalled();
  });
});
