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
import { canLoadDefinitionForCreation } from "./use-cases/load-agreement-definition.js";

vi.mock("./use-cases/load-agreement-definition.js");

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

  it("handles configured agreement.create commands internally", async () => {
    const server = hapi.server();
    await server.register(agreements);
    canLoadDefinitionForCreation.mockResolvedValue(true);

    await expect(
      canHandleInternalCommand(internalCommandTypes.AGREEMENT_CREATE, {
        data: { code: "pigs-might-fly", currentConfigVersion: "1.0.1" },
      }),
    ).resolves.toBe(true);

    expect(canLoadDefinitionForCreation).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      configVersion: "1.0.1",
    });
  });

  // A legacy grant is published through the config broker like any other, so it
  // has a config version; only the absent Agreement definition distinguishes it.
  it("leaves legacy agreement.create commands to the external service", async () => {
    const server = hapi.server();
    await server.register(agreements);
    canLoadDefinitionForCreation.mockResolvedValue(false);

    await expect(
      canHandleInternalCommand(internalCommandTypes.AGREEMENT_CREATE, {
        data: { code: "woodland", currentConfigVersion: "1.0.0" },
      }),
    ).resolves.toBe(false);
  });
});
