import hapi from "@hapi/hapi";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canHandleInternalCommand,
  clearInternalCommandHandlers,
  getInternalCommandHandler,
} from "../common/internal-command-bus.js";
import { internalCommandTypes } from "../common/internal-command-types.js";
import { agreements } from "./index.js";
import { handleCreateAgreementCommandUseCase } from "./use-cases/handle-create-agreement-command.use-case.js";
import { handleUpdateAgreementStatusCommandUseCase } from "./use-cases/handle-update-agreement-status-command.use-case.js";

describe("agreements", () => {
  afterEach(() => {
    clearInternalCommandHandlers();
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
  });

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
  ])("handles allowlisted %s commands internally", async (type) => {
    const server = hapi.server();
    await server.register(agreements);

    await expect(
      canHandleInternalCommand(type, {
        data: { code: "another-gas-grant", currentConfigVersion: "1.0.1" },
      }),
    ).resolves.toBe(true);
  });

  it.each([
    internalCommandTypes.AGREEMENT_CREATE,
    internalCommandTypes.AGREEMENT_STATUS_UPDATE,
  ])(
    "leaves grants outside the allowlist to the external service for %s",
    async (type) => {
      const server = hapi.server();
      await server.register(agreements);

      await expect(
        canHandleInternalCommand(type, {
          data: { code: "woodland", currentConfigVersion: "1.0.0" },
        }),
      ).resolves.toBe(false);
    },
  );
});
