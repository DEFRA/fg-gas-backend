import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { publish } from "../../common/sns-client.js";
import { Application } from "../models/application.js";
import {
  publishApplicationApproved,
  publishApplicationCreated,
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

    expect(publish).toHaveBeenCalledWith(
      config.applicationCreatedTopic,
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
          createdAt: application.createdAt,
          submittedAt: application.submittedAt,
          identifiers: application.identifiers,
          answers: application.answers,
        },
      }),
    );
  });
});

describe("publishApplicationApproved", () => {
  it("publishes ApplicationApprovedEvent to SNS topic", async () => {
    const application = new Application({
      clientRef: "456",
      code: "grant-code-2",
      createdAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      identifiers: { name: "Approved App" },
      answers: { question1: "approved answer" },
    });

    await publishApplicationApproved(application);

    expect(publish).toHaveBeenCalledWith(
      config.applicationApprovedTopic,
      expect.objectContaining({
        id: expect.any(String),
        source: "fg-gas-backend",
        specversion: "1.0",
        time: expect.any(String),
        type: "cloud.defra.test.fg-gas-backend.application.approved",
        datacontenttype: "application/json",
        data: {
          clientRef: application.clientRef,
          code: application.code,
          createdAt: application.createdAt,
          submittedAt: application.submittedAt,
          identifiers: application.identifiers,
          answers: application.answers,
        },
      }),
    );
  });
});
