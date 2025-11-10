import { describe, expect, it, vi } from "vitest";
import { Outbox } from "../models/outbox.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { createStatusTransitionUpdateUseCase } from "./create-status-transition-update.use-case.js";

vi.mock("../repositories/outbox.repository.js");

describe("create status transition update", () => {
  it("should create a callback handler that executes an outbox publisher command", async () => {
    const session = {};
    const handler = createStatusTransitionUpdateUseCase({
      clientRef: "some-client-ref",
      code: "some-code",
      newFullyQualifiedStatus: "SOME:STATUS:FOO",
      originalFullyQualifiedStatus: "SOME:STATUS:BARR",
    });
    await handler(session);
    expect(insertMany).toHaveBeenCalledWith([expect.any(Outbox)], session);
  });

  it("should do nothing if the statuses match", async () => {
    const session = {};
    const handler = createStatusTransitionUpdateUseCase({
      clientRef: "some-client-ref",
      code: "some-code",
      newFullyQualifiedStatus: "SOME:STATUS:FOO",
      originalFullyQualifiedStatus: "SOME:STATUS:FOO",
    });
    await handler(session);
    expect(insertMany).not.toHaveBeenCalled();
  });
});
