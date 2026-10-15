// Consumer test: fg-gas-backend reads an operator's app roles FROM
// fg-cw-backend, over HTTP, for the Grant Admin claims and allow-list pages.
//
// A separate provider name from the actuator pact
// (consumer.cw-backend-actuators.test.js), so each pair is verified on its own.
import { MatchersV3, PactV3 } from "@pact-foundation/pact";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withRequestContext } from "../../src/common/get-request-context.js";
import { findCwUserRoles } from "../../src/grant-admin/repositories/cw-users.repository.js";

const { eachLike, like, regex } = MatchersV3;

const { cwBackend } = vi.hoisted(() => ({
  cwBackend: { url: undefined, token: "gas-token", timeoutMs: 5000 },
}));

vi.mock("../../src/common/logger.js");
vi.mock("../../src/common/config.js", () => ({
  config: {
    cwBackend,
    httpClient: { timeoutMs: 5000 },
    tracingHeader: "x-cdp-request-id",
  },
}));

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const NO_ROLES_OID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const pact = new PactV3({
  consumer: "fg-gas-backend",
  provider: "fg-cw-backend-users",
  dir: path.resolve(process.cwd(), "tmp/pacts"),
  logLevel: "warn",
});

const authorization = regex("^Bearer .+$", "Bearer gas-token");

// Every call is made for the operator on the request, as the routes set it.
const asOperator = (call) => withRequestContext({ user: OID }, call);

const run = (interaction, test) =>
  pact.addInteraction(interaction).executeTest(async (mockServer) => {
    cwBackend.url = mockServer.url;

    return test();
  });

describe("fg-gas-backend consumer of fg-cw-backend's user roles", () => {
  describe("GET /api/users/{entraId}/roles", () => {
    it("answers the names of the operator's active app roles", () =>
      run(
        {
          states: [
            {
              description: "a user has app roles",
              parameters: { entraId: OID, roleName: "ROLE_WMP_CLAIMS" },
            },
          ],
          uponReceiving: "a read of a user's app roles",
          withRequest: {
            method: "GET",
            path: `/api/users/${OID}/roles`,
            headers: { authorization },
          },
          willRespondWith: {
            status: 200,
            body: {
              appRoles: eachLike({ roleName: like("ROLE_WMP_CLAIMS") }),
            },
          },
        },
        async () => {
          const roles = await asOperator(() => findCwUserRoles(OID));

          expect(roles).toEqual({ roles: ["ROLE_WMP_CLAIMS"] });
        },
      ));

    it("answers an empty list for a user with no active app roles", () =>
      run(
        {
          states: [
            {
              description: "a user has no app roles",
              parameters: { entraId: NO_ROLES_OID },
            },
          ],
          uponReceiving: "a read of the app roles of a user with none",
          withRequest: {
            method: "GET",
            path: `/api/users/${NO_ROLES_OID}/roles`,
            headers: { authorization },
          },
          willRespondWith: {
            status: 200,
            body: { appRoles: [] },
          },
        },
        async () => {
          const roles = await asOperator(() => findCwUserRoles(NO_ROLES_OID));

          expect(roles).toEqual({ roles: [] });
        },
      ));
  });
});
