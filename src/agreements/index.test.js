import hapi from "@hapi/hapi";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasConfigDefinition } from "../common/config-broker/config-catalog.repository.js";
import {
  canHandleInternalCommand,
  clearInternalCommandHandlers,
  getInternalCommandHandler,
} from "../common/internal-command-bus.js";
import { internalCommandTypes } from "../common/internal-command-types.js";
import { agreements } from "./index.js";
import { handleCreateAgreementCommandUseCase } from "./use-cases/handle-create-agreement-command.use-case.js";

vi.mock("../common/config-broker/config-catalog.repository.js");

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

  // Grants that publish no Agreement definition must keep routing to the
  // external Agreements service rather than failing in the loader.
  it("only handles agreement.create for grants with a published definition", async () => {
    const server = hapi.server();
    await server.register(agreements);

    hasConfigDefinition.mockResolvedValue(true);
    await expect(
      canHandleInternalCommand(internalCommandTypes.AGREEMENT_CREATE, {
        data: { code: "pigs-might-fly" },
      }),
    ).resolves.toBe(true);
    expect(hasConfigDefinition).toHaveBeenCalledWith({
      grantCode: "pigs-might-fly",
      definitionType: "agreement",
    });

    hasConfigDefinition.mockResolvedValue(false);
    await expect(
      canHandleInternalCommand(internalCommandTypes.AGREEMENT_CREATE, {
        data: { code: "woodland" },
      }),
    ).resolves.toBe(false);
  });
});
