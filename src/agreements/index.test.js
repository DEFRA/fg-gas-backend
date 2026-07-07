import hapi from "@hapi/hapi";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearInternalCommandHandlers,
  getInternalCommandHandler,
} from "../common/internal-command-bus.js";
import { internalCommandTypes } from "../common/internal-command-types.js";
import { agreements } from "./index.js";
import { handleCreateAgreementCommand } from "./use-cases/handle-create-agreement-command.use-case.js";

describe("agreements", () => {
  afterEach(() => {
    clearInternalCommandHandlers();
    vi.unstubAllEnvs();
  });

  it("registers as a hapi plugin", async () => {
    const server = hapi.server();
    await server.register(agreements);
    expect(server.registrations.agreements).toBeDefined();
  });

  it("registers the internal handler for agreement.create commands", async () => {
    const server = hapi.server();
    await server.register(agreements);

    expect(
      getInternalCommandHandler(internalCommandTypes.AGREEMENT_CREATE),
    ).toBe(handleCreateAgreementCommand);
  });

  it("fails to register when a registered agreement definition's endpoint has no URL configured", async () => {
    vi.stubEnv("GRANT_FUNDING_CALCULATOR_URL", "");

    const server = hapi.server();

    await expect(server.register(agreements)).rejects.toThrow(
      /Missing required endpoint URL env var\(s\): GRANT_FUNDING_CALCULATOR_URL/,
    );
  });
});
