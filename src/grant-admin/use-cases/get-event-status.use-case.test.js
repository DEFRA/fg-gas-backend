import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { findProgressById as findGasInboxProgress } from "../../events/repositories/inbox.repository.js";
import { findProgressById as findGasOutboxProgress } from "../../events/repositories/outbox.repository.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import { findCwEventStatus } from "../repositories/cw-actuators.repository.js";
import { getEventStatusUseCase } from "./get-event-status.use-case.js";

vi.mock("../../common/mongo-client.js");
vi.mock("../../events/write-audit-event.js");
vi.mock("../../events/repositories/inbox.repository.js");
vi.mock("../../events/repositories/outbox.repository.js");
vi.mock("../repositories/cw-actuators.repository.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const call = (overrides = {}) =>
  getEventStatusUseCase({ service: "gas", box: "inbox", id: ID, ...overrides });

describe("getEventStatusUseCase", () => {
  it("answers a GAS inbox row's status and attempts since its redrive", async () => {
    findGasInboxProgress.mockResolvedValue({
      status: "RESUBMITTED",
      completionAttempts: 2,
    });

    expect(await call()).toEqual({
      status: "RESUBMITTED",
      statusLabel: "Resubmitted",
      attemptsSinceRedrive: 2,
      maxAttempts: config.inbox.inboxMaxRetries,
    });
    expect(findGasInboxProgress).toHaveBeenCalledWith(ID);
  });

  it("answers a GAS outbox row with the outbox's own retries", async () => {
    findGasOutboxProgress.mockResolvedValue({
      status: "DEAD_LETTER",
      completionAttempts: 5,
    });

    expect(await call({ box: "outbox" })).toMatchObject({
      statusLabel: "Dead letter",
      maxAttempts: config.outbox.outboxMaxRetries,
    });
  });

  it("counts a row that has never failed as no attempts", async () => {
    findGasInboxProgress.mockResolvedValue({ status: "PUBLISHED" });

    expect((await call()).attemptsSinceRedrive).toBe(0);
  });

  it("is a 404 for a GAS row that does not exist", async () => {
    findGasInboxProgress.mockResolvedValue(null);

    const error = await call().catch((e) => e);

    expect(error.output.statusCode).toBe(404);
  });

  it("answers a Caseworking row from its status actuator, with its own retries", async () => {
    findCwEventStatus.mockResolvedValue({
      status: "FAILED",
      completionAttempts: 3,
      maxAttempts: 7,
    });

    expect(await call({ service: "caseworking", box: "outbox" })).toEqual({
      status: "FAILED",
      statusLabel: "Failed",
      attemptsSinceRedrive: 3,
      maxAttempts: 7,
    });
    expect(findCwEventStatus).toHaveBeenCalledWith("outbox", ID);
  });

  it("passes a Caseworking failure on", async () => {
    findCwEventStatus.mockRejectedValue(Boom.notFound("missing"));

    const error = await call({ service: "caseworking" }).catch((e) => e);

    expect(error.output.statusCode).toBe(404);
  });

  // It reads no payload; the detail read is what audits.
  it("writes no audit event", async () => {
    findGasInboxProgress.mockResolvedValue({ status: "COMPLETED" });
    findCwEventStatus.mockResolvedValue({
      status: "COMPLETED",
      maxAttempts: 7,
    });

    await call();
    await call({ service: "caseworking" });

    expect(writeAuditEvent).not.toHaveBeenCalled();
  });
});
