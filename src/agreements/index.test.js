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

  // Applications whose config version has no usable definition must keep
  // routing to the external Agreements service rather than failing in the
  // loader, so routing asks exactly what creation will resolve.
  it("only handles agreement.create when the config version resolves", async () => {
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

    canLoadDefinitionForCreation.mockResolvedValue(false);
    await expect(
      canHandleInternalCommand(internalCommandTypes.AGREEMENT_CREATE, {
        data: { code: "woodland", currentConfigVersion: "1.2.3" },
      }),
    ).resolves.toBe(false);
  });
});
