import { describe, expect, it } from "vitest";
import { Position } from "../models/position.js";
import { ApplicationStatusUpdatedEvent } from "./application-status-updated.event.js";

describe("ApplicationStatusUpdatedEvent", () => {
  describe("forPositions", () => {
    it("carries the positions as fully qualified statuses", () => {
      const previousPosition = new Position({
        phase: "PRE_AWARD",
        stage: "ASSESSMENT",
        status: "WITHDRAWAL_REQUESTED",
      });

      const event = ApplicationStatusUpdatedEvent.forPositions({
        clientRef: "client-1",
        code: "grant-1",
        currentConfigVersion: "1.0.0",
        previousPosition,
        currentPosition: previousPosition.withStatus("APPLICATION_WITHDRAWN"),
      });

      expect(event).toBeInstanceOf(ApplicationStatusUpdatedEvent);
      expect(event.data).toStrictEqual({
        clientRef: "client-1",
        grantCode: "grant-1",
        currentConfigVersion: "1.0.0",
        previousStatus: "PRE_AWARD:ASSESSMENT:WITHDRAWAL_REQUESTED",
        currentStatus: "PRE_AWARD:ASSESSMENT:APPLICATION_WITHDRAWN",
      });
    });
  });
});
