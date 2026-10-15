import { describe, expect, it } from "vitest";
import { Position } from "../models/position.js";
import { ApplicationCreatedEvent } from "./application-created.event.js";

describe("ApplicationCreatedEvent", () => {
  it("carries the position as its fully qualified status", () => {
    const event = new ApplicationCreatedEvent({
      clientRef: "client-1",
      code: "grant-1",
      originalConfigVersion: "1.0.0",
      position: new Position({
        phase: "PRE_AWARD",
        stage: "ASSESSMENT",
        status: "APPLICATION_RECEIVED",
      }),
    });

    expect(event.data).toStrictEqual({
      clientRef: "client-1",
      code: "grant-1",
      originalConfigVersion: "1.0.0",
      status: "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED",
    });
  });
});
