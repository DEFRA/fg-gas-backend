import { describe, expect, it } from "vitest";

import {
  Application,
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../models/application.js";
import { CreateAgreementCommand } from "./create-agreement.command.js";

describe("CreateAgreementCommand", () => {
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
      phases: [
        {
          code: ApplicationPhase.PreAward,
          answers: { question1: "answer1" },
        },
      ],
    });

    const event = new CreateAgreementCommand(application);

    expect(event).toEqual({
      id: expect.any(String),
      type: "cloud.defra.local.fg-gas-backend.agreement.create",
      source: "fg-gas-backend",
      specversion: "1.0",
      time: expect.any(String),
      datacontenttype: "application/json",
      data: {
        clientRef: "123",
        code: "grant-code",
        identifiers: {
          name: "Test App",
        },
        metadata: {},
        answers: {
          question1: "answer1",
        },
      },
    });
  });
});
