import hapi from "@hapi/hapi";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internalCommandTypes } from "../common/internal-command-types.js";
import {
  canHandleInternally,
  clearInternalMessageHandlers,
} from "../common/internal-message-bus.js";
import { agreements } from "./index.js";

describe("agreements", () => {
  afterEach(() => {
    clearInternalMessageHandlers();
    vi.unstubAllEnvs();
  });

  it("registers as a hapi plugin", async () => {
    const server = hapi.server();
    await server.register(agreements);
    expect(server.registrations.agreements).toBeDefined();
  });

  it("registers current-page and Agreement action endpoints", async () => {
    const server = hapi.server();
    await server.register(agreements);

    const routes = server.table().map(({ method, path }) => ({ method, path }));

    expect(routes).toEqual(
      expect.arrayContaining([
        { method: "get", path: "/agreements/current" },
        { method: "get", path: "/agreements/{agreementNumber}" },
        {
          method: "get",
          path: "/agreements/{agreementNumber}/items/{agreementItemId}/actions/{actionName}",
        },
        {
          method: "post",
          path: "/agreements/{agreementNumber}/items/{agreementItemId}/actions/{actionName}",
        },
      ]),
    );
    expect(routes).not.toContainEqual({
      method: "get",
      path: "/agreements/render",
    });
  });

  it("accepts create commands only for registered Agreement definitions", async () => {
    const server = hapi.server();
    await server.register(agreements);

    expect(
      canHandleInternally({
        type: internalCommandTypes.AGREEMENT_CREATE,
        data: { code: "pigs-might-fly" },
      }),
    ).toBe(true);
    expect(
      canHandleInternally({
        type: internalCommandTypes.AGREEMENT_CREATE,
        data: { code: "farming-post-transition-tier" },
      }),
    ).toBe(false);
  });

  it("fails to register when a registered agreement definition's endpoint has no URL configured", async () => {
    vi.stubEnv("GRANT_FUNDING_CALCULATOR_URL", "");

    const server = hapi.server();

    await expect(server.register(agreements)).rejects.toThrow(
      /Missing required endpoint URL env var\(s\): GRANT_FUNDING_CALCULATOR_URL/,
    );
  });
});
