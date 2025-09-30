import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { publish } from "../../common/sns-client.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";
import {
  Application,
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../models/application.js";
import {
  publishCreateNewCase,
  publishUpdateCaseStatus,
} from "./case-event.publisher.js";

vi.mock("../../common/sns-client.js");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-05-28T20:40:48.451Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("publishCreateNewCase", () => {
  it("publishes CreateNewCaseEvent to SNS topic", async () => {
    const application = new Application({
      phase: ApplicationPhase.PreAward,
      stage: ApplicationStage.Assessment,
      status: ApplicationStatus.Received,
      clientRef: "123",
      code: "grant-code",
      createdAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      identifiers: { name: "Test App" },
      answers: { question1: "answer1" },
    });

    await publishCreateNewCase(application);

    expect(publish).toHaveBeenCalledWith(
      config.sns.createNewCaseTopicArn,
      expect.objectContaining({
        id: expect.any(String),
        source: "fg-gas-backend",
        specversion: "1.0",
        time: "2025-05-28T20:40:48.451Z",
        type: "cloud.defra.test.fg-gas-backend.case.create",
        datacontenttype: "application/json",
        data: {
          caseRef: "123",
          workflowCode: "grant-code",
          status: "NEW",
          payload: {
            answers: {
              question1: "answer1",
            },
            createdAt: "2025-05-28T20:40:48.451Z",
            identifiers: {
              name: "Test App",
            },
            submittedAt: "2025-05-28T20:40:48.451Z",
          },
        },
      }),
    );
  });
});

describe("publishUpdateApplicationStatus", () => {
  it("should publish status update command", async () => {
    await publishUpdateCaseStatus({
      clientRef: "1w4",
      code: "grant-code",
      targetNode: "agreements",
      agreementData: {
        agreementRef: "Agreement-1",
      },
    });
    expect(publish.mock.calls[0][0]).toBe(config.sns.updateCaseStatusTopicArn);
    expect(publish.mock.calls[0][1]).toBeInstanceOf(UpdateCaseStatusCommand);
  });
});
