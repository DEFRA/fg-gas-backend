import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { publish } from "../../common/sns-client.js";
import {
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../models/application.js";
import {
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

it("publishes ApplicationCreatedEvent", async () => {
  await publishApplicationCreated({
    clientRef: "123",
    code: "grant-code",
    status: `${ApplicationPhase.PreAward}:${ApplicationStage.Assessment}:${ApplicationStatus.Received}`,
  });

  expect(publish).toHaveBeenCalledWith(
    config.sns.grantApplicationCreatedTopicArn,
    expect.objectContaining({
      id: expect.any(String),
      source: "fg-gas-backend",
      specversion: "1.0",
      time: "2025-05-28T20:40:48.451Z",
      type: "cloud.defra.local.fg-gas-backend.application.created",
      datacontenttype: "application/json",
      data: {
        clientRef: "123",
        code: "grant-code",
        status: `${ApplicationPhase.PreAward}:${ApplicationStage.Assessment}:${ApplicationStatus.Received}`,
      },
    }),
  );
});

it("publishes ApplicationStatusUpdatedEvent", async () => {
  await publishApplicationStatusUpdated({
    clientRef: "123",
    code: "grant-code",
    previousStatus: `${ApplicationPhase.PreAward}:${ApplicationStage.Assessment}:${ApplicationStatus.Received}`,
    currentStatus: `${ApplicationPhase.PreAward}:${ApplicationStage.Assessment}:${ApplicationStatus.Approved}`,
  });

  expect(publish).toHaveBeenCalledWith(
    config.sns.grantApplicationStatusUpdatedTopicArn,
    expect.objectContaining({
      id: expect.any(String),
      source: "fg-gas-backend",
      specversion: "1.0",
      time: "2025-05-28T20:40:48.451Z",
      type: "cloud.defra.local.fg-gas-backend.application.status.updated",
      datacontenttype: "application/json",
      data: {
        clientRef: "123",
        grantCode: "grant-code",
        previousStatus: `${ApplicationPhase.PreAward}:${ApplicationStage.Assessment}:${ApplicationStatus.Received}`,
        currentStatus: `${ApplicationPhase.PreAward}:${ApplicationStage.Assessment}:${ApplicationStatus.Approved}`,
      },
    }),
  );
});

it("publishes publishCreateAgreementCommand", async () => {
  await publishCreateAgreementCommand({
    clientRef: "123",
    code: "grant-code",
    identifiers: { sbi: "123456789" },
    answers: { question1: "answer1" },
  });

  expect(publish).toHaveBeenCalledWith(
    config.sns.createAgreementTopicArn,
    expect.objectContaining({
      id: expect.any(String),
      source: "fg-gas-backend",
      specversion: "1.0",
      time: "2025-05-28T20:40:48.451Z",
      type: "cloud.defra.local.fg-gas-backend.agreement.create",
      datacontenttype: "application/json",
      data: {
        clientRef: "123",
        code: "grant-code",
        identifiers: { sbi: "123456789" },
        answers: { question1: "answer1" },
      },
    }),
  );
});
