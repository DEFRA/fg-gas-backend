import hapi from "@hapi/hapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../common/config.js";
import {
  canHandleInternalCommand,
  clearInternalCommandHandlers,
  getInternalCommandHandler,
} from "../common/internal-command-handlers.js";
import { internalCommandTypes } from "../common/internal-command-types.js";
import { agreements } from "./index.js";
import { handleCreateAgreementCommandUseCase } from "./use-cases/handle-create-agreement-command.use-case.js";
import { handleUpdateAgreementStatusCommandUseCase } from "./use-cases/handle-update-agreement-status-command.use-case.js";

describe("agreements", () => {
  const originalLegacyCodes = config.legacyAgreementGrantCodes;

  beforeEach(() => {
    config.legacyAgreementGrantCodes = ["legacy-test-code"];
  });

  afterEach(() => {
    clearInternalCommandHandlers();
    config.legacyAgreementGrantCodes = originalLegacyCodes;
    vi.resetAllMocks();
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
        {
          method: "get",
          path: "/agreements/{agreementNumber}/document",
        },
        {
          method: "get",
          path: "/agreements/{agreementNumber}/actions/{actionName}",
        },
        {
          method: "post",
          path: "/agreements/{agreementNumber}/actions/{actionName}",
        },
      ]),
    );
    expect(routes).not.toContainEqual({
      method: "get",
      path: "/agreements/render",
    });
    expect(
      routes.filter(({ path }) => path.startsWith("/admin/migrations/woodland")),
    ).toEqual([]);
  });

  it.each(["dry-run", "apply", "catch-up"])(
    "does not expose the former Woodland %s migration endpoint",
    async (operation) => {
      const server = hapi.server();
      await server.register(agreements);

      const response = await server.inject({
        method: "POST",
        url: `/admin/migrations/woodland/${operation}`,
      });

      expect(response.statusCode).toBe(404);
    },
  );

  it("registers the internal handler for agreement.create commands", async () => {
    const server = hapi.server();
    await server.register(agreements);

    expect(
      getInternalCommandHandler(internalCommandTypes.AGREEMENT_CREATE),
    ).toBe(handleCreateAgreementCommandUseCase);
  });

  it("registers the internal handler for agreement.status.update commands", async () => {
    const server = hapi.server();
    await server.register(agreements);

    expect(
      getInternalCommandHandler(internalCommandTypes.AGREEMENT_STATUS_UPDATE),
    ).toBe(handleUpdateAgreementStatusCommandUseCase);
  });

  it.each([
    internalCommandTypes.AGREEMENT_CREATE,
    internalCommandTypes.AGREEMENT_STATUS_UPDATE,
  ])("handles non-legacy %s commands internally", async (type) => {
    const server = hapi.server();
    await server.register(agreements);

    await expect(
      canHandleInternalCommand(type, {
        data: { code: "future-grant", currentConfigVersion: "1.0.1" },
      }),
    ).resolves.toBe(true);
  });

  it.each([
    internalCommandTypes.AGREEMENT_CREATE,
    internalCommandTypes.AGREEMENT_STATUS_UPDATE,
  ])(
    "leaves explicitly legacy grants to the external service for %s",
    async (type) => {
      const server = hapi.server();
      await server.register(agreements);

      await expect(
        canHandleInternalCommand(type, {
          data: { code: "legacy-test-code", currentConfigVersion: "1.0.0" },
        }),
      ).resolves.toBe(false);
    },
  );

  it.each([
    internalCommandTypes.AGREEMENT_CREATE,
    internalCommandTypes.AGREEMENT_STATUS_UPDATE,
  ])("handles Woodland %s commands internally", async (type) => {
    const server = hapi.server();
    await server.register(agreements);

    await expect(
      canHandleInternalCommand(type, {
        data: { code: "woodland", currentConfigVersion: "1.0.0" },
      }),
    ).resolves.toBe(true);
  });

  it("treats an explicitly empty legacy list as GAS owning every grant", async () => {
    config.legacyAgreementGrantCodes = [];
    const server = hapi.server();
    await server.register(agreements);

    await expect(
      canHandleInternalCommand(internalCommandTypes.AGREEMENT_CREATE, {
        data: { code: "future-grant" },
      }),
    ).resolves.toBe(true);
  });
});
