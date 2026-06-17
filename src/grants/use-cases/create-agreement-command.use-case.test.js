import { describe, expect, it, vi } from "vitest";
import { Application } from "../models/application.js";
import { Outbox } from "../models/outbox.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { createAgreementCommandUseCase } from "./create-agreement-command.use-case.js";

vi.mock("../repositories/application.repository.js");
vi.mock("../repositories/outbox.repository.js");

describe("create agreement use case", () => {
  it("creates an agreement create command outbox record", async () => {
    const session = {};
    const application = Application.new({
      currentPhase: "PRE_AWARD",
      currentStage: "AWARD",
      currentStatus: "REVIEW",
      clientRef: "1234",
      code: "frps-beta",
      identifiers: {
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
      },
      phases: [],
    });
    findByClientRefAndCode.mockResolvedValue(application);
    await createAgreementCommandUseCase(
      { clientRef: "client-ref", code: "code", eventData: {} },
      session,
    );
    expect(insertMany).toHaveBeenCalledWith([expect.any(Outbox)], session);

    const [outbox] = insertMany.mock.calls[0][0];
    expect(outbox.event.data).toEqual({
      clientRef: "1234",
      code: "frps-beta",
      identifiers: {
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
      },
      metadata: {},
      answers: {},
    });
    expect(outbox.event.type).toBe(
      "cloud.defra.local.fg-gas-backend.agreement.create",
    );
  });
});
