import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { publish } from "../../common/sns-client.js";
import { CreateAgreementCommand } from "../events/agreement-created.event.js";
import { ApplicationCreatedEvent } from "../events/application-created.event.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { ApplicationUpdateStatusCommand } from "../events/application-update-status.command.js";
import { Application } from "../models/application.js";
import {
  publishApplicationApprovedEvent,
  publishApplicationCreated,
  publishApplicationStatusUpdated,
  publishCreateAgreementCommand,
  publishUpdateApplicationStatusCommand,
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
      clientRef: "123",
      code: "grant-code",
      createdAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      identifiers: { name: "Test App" },
      answers: { question1: "answer1" },
    });

    await publishApplicationCreated(application);

    expect(publish.mock.calls[0][0]).toBe(config.applicationCreatedTopic);
    expect(publish.mock.calls[0][1]).toBeInstanceOf(ApplicationCreatedEvent);
    expect(publish.mock.calls[0][1].data).toEqual({
      clientRef: application.clientRef,
      code: application.code,
      createdAt: application.createdAt,
      submittedAt: application.submittedAt,
      identifiers: application.identifiers,
      answers: application.answers,
    });
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

describe("publishUpdateApplicationStatusCommand", () => {
  it("should publish status update command", async () => {
    await publishUpdateApplicationStatusCommand({
      clientRef: "1w4",
      code: "grant-code",
      agreementData: {
        agreementRef: "Agreement-1",
      },
    });
    expect(publish.mock.calls[0][0]).toBe(config.sns.updateCaseStatusTopicArn);
    expect(publish.mock.calls[0][1]).toBeInstanceOf(
      ApplicationUpdateStatusCommand,
    );
  });
});
