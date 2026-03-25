import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApplication } from "../../../test/helpers/applications.js";
import { config } from "../../common/config.js";
import { Agreement } from "../models/agreement.js";
import { Outbox } from "../models/outbox.js";
import {
  createApplicationStatusUpdatedEventData,
  createApplicationStatusUpdatedOutbox,
} from "./agreement-case-update.helpers.js";

describe("agreement-case-update.helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T10:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates an application status updated event", () => {
    const application = createTestApplication({
      currentStatus: "APPLICATION_APPROVED",
    });

    const event = createApplicationStatusUpdatedEventData({
      clientRef: application.clientRef,
      code: application.code,
      previousStatus: "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED",
      application,
    });

    expect(event.data).toEqual({
      clientRef: "application-1",
      grantCode: "grant-1",
      previousStatus: "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED",
      currentStatus: "PRE_AWARD:ASSESSMENT:APPLICATION_APPROVED",
    });
  });

  it("creates an application status updated outbox", () => {
    const agreement = Agreement.new({
      agreementRef: "agreement-1",
      date: "2024-01-15T10:30:00.000Z",
    });
    const application = createTestApplication({
      agreements: {
        "agreement-1": agreement,
      },
      currentStatus: "APPLICATION_APPROVED",
    });

    const outbox = createApplicationStatusUpdatedOutbox({
      clientRef: application.clientRef,
      code: application.code,
      previousStatus: "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED",
      application,
    });

    expect(outbox).toBeInstanceOf(Outbox);
    expect(outbox.target).toBe(
      config.sns.grantApplicationStatusUpdatedTopicArn,
    );
    expect(outbox.event.data).toEqual({
      clientRef: "application-1",
      grantCode: "grant-1",
      previousStatus: "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED",
      currentStatus: "PRE_AWARD:ASSESSMENT:APPLICATION_APPROVED",
    });
    expect(outbox.segregationRef).toBe(Outbox.getSegregationRef(outbox.event));
  });
});
