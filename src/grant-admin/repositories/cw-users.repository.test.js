import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { wreck } from "../../common/wreck.js";
import { findCwUserRoles } from "./cw-users.repository.js";

const { cwBackend } = vi.hoisted(() => ({
  cwBackend: { url: undefined, token: undefined },
}));

vi.mock("../../common/config.js", () => ({ config: { cwBackend } }));
vi.mock("../../common/logger.js");
vi.mock("../../common/wreck.js", () => ({ wreck: { get: vi.fn() } }));

const URL_BASE = "http://cw.test";
const TOKEN = "cw-token";
const TIMEOUT_MS = 3000;

const calledUrl = () => new URL(wreck.get.mock.calls[0][0]);

const httpError = (statusCode, body) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: {
      payload:
        body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
    },
  });

beforeEach(() => {
  cwBackend.url = URL_BASE;
  cwBackend.token = TOKEN;
  cwBackend.timeoutMs = TIMEOUT_MS;
});

describe("findCwUserRoles", () => {
  const ENTRA_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

  const appRole = (roleName) => ({ roleName, from: null, to: null });

  it("GETs /api/users/{entraId}/roles with the bearer token", async () => {
    wreck.get.mockResolvedValue({ payload: { appRoles: [] } });

    await findCwUserRoles(ENTRA_ID);

    expect(calledUrl().pathname).toEqual(`/api/users/${ENTRA_ID}/roles`);
    expect(wreck.get.mock.calls[0][1]).toEqual({
      json: true,
      timeout: TIMEOUT_MS,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  });

  it("answers the names of the user's active roles", async () => {
    wreck.get.mockResolvedValue({
      payload: { appRoles: [appRole("ROLE_A"), appRole("ROLE_B")] },
    });

    expect(await findCwUserRoles(ENTRA_ID)).toEqual({
      roles: ["ROLE_A", "ROLE_B"],
    });
  });

  it("answers an empty list for a user with no roles", async () => {
    wreck.get.mockResolvedValue({ payload: { appRoles: [] } });

    expect(await findCwUserRoles(ENTRA_ID)).toEqual({ roles: [] });
  });

  // Logged by the caller, and only when the roles were needed.
  it.each([
    [
      "an HTTP failure",
      httpError(500, { message: "SECRET-BODY" }),
      "Caseworking is unavailable (HTTP 500)",
    ],
    ["a timeout", httpError(504), "Caseworking is unavailable (timeout)"],
    [
      "a transport failure",
      new Error("ECONNREFUSED"),
      "Caseworking is unavailable (read failed)",
    ],
  ])("answers no roles, without logging, on %s", async (_, error, failure) => {
    wreck.get.mockRejectedValue(error);

    expect(await findCwUserRoles(ENTRA_ID)).toEqual({ roles: null, failure });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["no body", undefined],
    ["no role list", {}],
    ["a role without a name", { appRoles: [{ from: null, to: null }] }],
  ])("answers no roles for a body with %s", async (_, payload) => {
    wreck.get.mockResolvedValue({ payload });

    expect(await findCwUserRoles(ENTRA_ID)).toEqual({
      roles: null,
      failure: "Caseworking answered an unreadable body",
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("answers no roles without calling caseworking when it is not configured", async () => {
    cwBackend.token = undefined;

    expect(await findCwUserRoles(ENTRA_ID)).toEqual({
      roles: null,
      failure: "Caseworking is not configured",
    });
    expect(wreck.get).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
