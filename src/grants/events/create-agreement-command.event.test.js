import { describe, expect, it } from "vitest";

import {
  Application,
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../models/application.js";
import { CreateAgreementCommand } from "./create-agreement-command.event.js";

describe("Create agreement command", () => {
  it("should create event", () => {
    const application = Application.new({
      currentPhase: ApplicationPhase.PreAward,
      currentStage: ApplicationStage.Assessment,
      currentStatus: ApplicationStatus.Received,
      clientRef: "123",
      code: "grant-code",
      createdAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      identifiers: { name: "Test App" },
      answers: { question1: "answer1" },
    });
    const event = new CreateAgreementCommand(application);
    const { clientRef, code, answers } = application;
    expect(event.data.clientRef).toBe(clientRef);
    expect(event.data.code).toBe(code);
    expect(event.data.answers).toBe(answers);
  });
});
