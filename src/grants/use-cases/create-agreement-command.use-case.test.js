import { describe, expect, it, vi } from "vitest";
import { CreateAgreementCommand } from "../events/create-agreement.command.js";
import { Application } from "../models/application.js";
import { Outbox } from "../models/outbox.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { createAgreementCommandUseCase } from "./create-agreement-command.use-case.js";

vi.mock("../repositories/outbox.repository.js");
vi.mock("../events/create-agreement.command.js");

describe("create agreement use case", () => {
  it("should create outbox publication", async () => {
    const session = {};
    const application = Application.new({
      currentPhase: "PRE_AWARD",
      currentStage: "AWARD",
      currentStatus: "REVIEW",
      clientRef: "1234",
      code: "frps-beta",
    });
    await createAgreementCommandUseCase({ application }, session);
    expect(CreateAgreementCommand).toHaveBeenCalled();
    expect(insertMany).toHaveBeenCalledWith([expect.any(Outbox)], session);
  });
});
