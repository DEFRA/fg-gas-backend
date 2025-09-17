import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationStatus } from "../../common/application-status.js";
import { config } from "../../common/config.js";
import { publish } from "../../common/sns-client.js";
import { CreateAgreementCommand } from "../events/agreement-created.event.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import {
  Application,
  ApplicationPhase,
  ApplicationStage,
} from "../models/application.js";
import {
  publishApplicationApprovedEvent,
  publishApplicationCreated,
  publishApplicationStatusUpdated,
  publishCreateAgreementCommand,
} from "./application-event.publisher.js";

vi.mock("../../common/sns-client.js");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-05-28T20:40:48.451Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("publishApplicationCreated", () => {
  it("publishes ApplicationCreatedEvent to SNS topic", async () => {
    const application = new Application({
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

    await publishApplicationCreated({
      clientRef: application.clientRef,
      code: application.code,
      status: application.getFullyQualifiedStatus(),
    });

    expect(publish).toHaveBeenCalledWith(
      config.sns.grantApplicationCreatedTopicArn,
      expect.objectContaining({
        id: expect.any(String),
        source: "fg-gas-backend",
        specversion: "1.0",
        time: "2025-05-28T20:40:48.451Z",
        type: "cloud.defra.test.fg-gas-backend.application.created",
        datacontenttype: "application/json",
        data: {
          clientRef: application.clientRef,
          code: application.code,
          status: `${ApplicationPhase.PreAward}:${ApplicationStage.Assessment}:${ApplicationStatus.Received}`,
        },
      }),
    );
  });
});

describe("publishApplicationApprovedEvent", () => {
  it("publishes ApplicationApprovedEvent to SNS topic", async () => {
    const applicationApproved = {
      clientRef: "456",
      previousStatus: "received",
      currentStatus: "approved",
    };

    await publishApplicationApprovedEvent(applicationApproved);

    expect(publish).toHaveBeenCalledWith(
      config.sns.grantApplicationStatusUpdatedTopicArn,
      expect.objectContaining({
        id: expect.any(String),
        source: "fg-gas-backend",
        specversion: "1.0",
        time: expect.any(String),
        type: "cloud.defra.test.fg-gas-backend.application.approved",
        datacontenttype: "application/json",
        data: {
          clientRef: applicationApproved.clientRef,
          previousStatus: applicationApproved.previousStatus,
          currentStatus: applicationApproved.currentStatus,
        },
      }),
    );
  });
});

describe("publishCreateAgreementCommand", () => {
  it("publishes AgreementCreatedEvent to SQS queue", async () => {
    const application = new Application({
      id: "app-id-123",
      clientRef: "789",
      code: "grant-code-3",
      createdAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      identifiers: { name: "Agreement App" },
      answers: { question1: "agreement answer", question2: "value2" },
    });

    await publishCreateAgreementCommand(application);

    expect(publish.mock.calls[0][0]).toBe(config.sns.createAgreementTopicArn);
    expect(publish.mock.calls[0][1]).toBeInstanceOf(CreateAgreementCommand);
    expect(publish.mock.calls[0][1].data).toEqual({
      clientRef: application.clientRef,
      applicationData: {
        id: application.id,
        workflowCode: application.code,
        answers: application.answers,
      },
    });
  });
});

describe("publishApplicationStatusUpdated", () => {
  it("should publish status updated", async () => {
    const application = new Application({
      clientRef: "123",
      code: "grant-code",
      createdAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      identifiers: { name: "Test App" },
      answers: { question1: "answer1" },
    });

    await publishApplicationStatusUpdated(application);
    expect(publish.mock.calls[0][0]).toBe(
      config.sns.grantApplicationStatusUpdatedTopicArn,
    );
    expect(publish.mock.calls[0][1]).toBeInstanceOf(
      ApplicationStatusUpdatedEvent,
    );
  });
});
