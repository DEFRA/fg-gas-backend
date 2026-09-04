import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { writeAuditEvent } from "../../common/write-audit-event.js";
import {
  countByStatus as countGasInbox,
  findDeadLetterIds as gasInboxIds,
  redriveById as redriveGasInbox,
} from "../../grants/repositories/inbox.repository.js";
import {
  countByStatus as countGasOutbox,
  findDeadLetterIds as gasOutboxIds,
  redriveById as redriveGasOutbox,
} from "../../grants/repositories/outbox.repository.js";
import {
  countCwInbox,
  countCwOutbox,
  findCwDeadLetterIds,
  isCwConfigured,
  redriveCwEvent,
} from "../repositories/cw-actuators.repository.js";

vi.mock("../../common/logger.js");
vi.mock("../../common/write-audit-event.js");
vi.mock("../../grants/repositories/inbox.repository.js", () => ({
  countByStatus: vi.fn(),
  findDeadLetterIds: vi.fn(),
  redriveById: vi.fn(),
}));
vi.mock("../../grants/repositories/outbox.repository.js", () => ({
  countByStatus: vi.fn(),
  findDeadLetterIds: vi.fn(),
  redriveById: vi.fn(),
}));
vi.mock("../../common/config.js", () => ({
  config: {
    inbox: { inboxMaxRetries: 5 },
    outbox: { outboxMaxRetries: 4 },
    cwBackend: { url: "http://cw.test", token: "cw-token" },
    httpClient: { timeoutMs: 3000 },
    tracingHeader: "x-cdp-request-id",
  },
}));
vi.mock(
  "../repositories/cw-actuators.repository.js",
  async (importOriginal) => ({
    ...(await importOriginal()),
    countCwInbox: vi.fn(),
    countCwOutbox: vi.fn(),
    findCwDeadLetterIds: vi.fn(),
    isCwConfigured: vi.fn(),
    redriveCwEvent: vi.fn(),
  }),
);

const { redriveQueryUseCase } = await import("./redrive-query.use-case.js");

const ZERO = {
  PUBLISHED: 0,
  PROCESSING: 0,
  FAILED: 0,
  RESUBMITTED: 0,
  COMPLETED: 0,
  DEAD_LETTER: 0,
  PARKED: 0,
};

const counts = (deadLetter) => ({ ...ZERO, DEAD_LETTER: deadLetter });

// Caseworking's counts endpoint answers with a facets envelope; only the
// status block matters here, and the use case has to reach into it.
const cwCounts = (deadLetter) => ({ counts: counts(deadLetter) });

const ids = (count, prefix) =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

const call = (overrides = {}) =>
  redriveQueryUseCase({ limit: 500, caller: "admin-ui", ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
  isCwConfigured.mockReturnValue(true);
  countGasInbox.mockResolvedValue(counts(0));
  countGasOutbox.mockResolvedValue(counts(0));
  countCwInbox.mockResolvedValue(cwCounts(0));
  countCwOutbox.mockResolvedValue(cwCounts(0));
  gasInboxIds.mockResolvedValue([]);
  gasOutboxIds.mockResolvedValue([]);
  findCwDeadLetterIds.mockResolvedValue([]);
  redriveGasInbox.mockResolvedValue({ _id: "x" });
  redriveGasOutbox.mockResolvedValue({ _id: "x" });
  redriveCwEvent.mockResolvedValue({ _id: "x" });
});

describe("redriveQueryUseCase", () => {
  it("counts the matching dead letters and redrives each one", async () => {
    countGasInbox.mockResolvedValue(counts(3));
    gasInboxIds.mockResolvedValue(ids(3, "gi"));

    const result = await call();

    expect(result.matched).toBe(3);
    expect(result.processed).toBe(3);
    expect(result.redriven).toBe(3);
    expect(redriveGasInbox).toHaveBeenCalledTimes(3);
  });

  it("collects ids BEFORE redriving, so a shrinking result set cannot skip rows", async () => {
    const order = [];

    countGasInbox.mockResolvedValue(counts(2));
    gasInboxIds.mockImplementation(async () => {
      order.push("collect");

      return ids(2, "gi");
    });
    redriveGasInbox.mockImplementation(async () => {
      order.push("redrive");

      return { _id: "x" };
    });

    await call();

    expect(order).toEqual(["collect", "redrive", "redrive"]);
  });

  it("passes the filter to the count and to the id collection, never a status", async () => {
    await call({ q: "GLD-9B2", error: "boom" });

    const filter = {
      q: "GLD-9B2",
      error: "boom",
      from: undefined,
      to: undefined,
    };

    expect(countGasInbox).toHaveBeenCalledWith(filter);
    expect(gasInboxIds).toHaveBeenCalledWith(filter, 500);
    expect(countGasInbox.mock.calls[0][0]).not.toHaveProperty("status");
    expect(countGasInbox.mock.calls[0][0]).not.toHaveProperty("kind");
  });

  it("reports matched separately from processed when the limit bites", async () => {
    countGasInbox.mockResolvedValue(counts(100));
    gasInboxIds.mockResolvedValue(ids(5, "gi"));

    const result = await call({ limit: 5 });

    expect(gasInboxIds).toHaveBeenCalledWith(expect.anything(), 5);
    expect(result.matched).toBe(100);
    expect(result.processed).toBe(5);
  });

  it("shares one budget across the sources, in their fixed order", async () => {
    countGasInbox.mockResolvedValue(counts(3));
    gasInboxIds.mockResolvedValue(ids(3, "gi"));
    countGasOutbox.mockResolvedValue(counts(10));
    gasOutboxIds.mockResolvedValue(ids(2, "go"));

    await call({ limit: 5 });

    expect(gasInboxIds).toHaveBeenCalledWith(expect.anything(), 5);
    expect(gasOutboxIds).toHaveBeenCalledWith(expect.anything(), 2);
  });

  it("stops collecting once the budget is spent, but still reports what matched", async () => {
    countGasInbox.mockResolvedValue(counts(2));
    gasInboxIds.mockResolvedValue(ids(2, "gi"));
    countGasOutbox.mockResolvedValue(counts(7));

    const result = await call({ limit: 2 });

    expect(gasOutboxIds).not.toHaveBeenCalled();
    expect(result.matched).toBe(9);
    expect(result.processed).toBe(2);
  });

  it("counts a GAS row that stopped being DEAD_LETTER as a conflict, not a failure", async () => {
    countGasInbox.mockResolvedValue(counts(2));
    gasInboxIds.mockResolvedValue(ids(2, "gi"));
    redriveGasInbox
      .mockResolvedValueOnce({ _id: "x" })
      .mockResolvedValueOnce(null);

    const result = await call();

    expect(result.redriven).toBe(1);
    expect(result.conflicts).toBe(1);
    expect(result.failures).toBe(0);
  });

  it("counts a Caseworking 409 as a conflict too", async () => {
    countCwInbox.mockResolvedValue(cwCounts(1));
    findCwDeadLetterIds.mockResolvedValueOnce(["cw-0"]);
    redriveCwEvent.mockRejectedValue(Boom.conflict("is COMPLETED"));

    const result = await call({ service: "caseworking" });

    expect(result.conflicts).toBe(1);
    expect(result.failures).toBe(0);
  });

  it("counts anything else as a failure and carries on with the rest", async () => {
    countGasInbox.mockResolvedValue(counts(3));
    gasInboxIds.mockResolvedValue(ids(3, "gi"));
    redriveGasInbox
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ _id: "x" });

    const result = await call();

    expect(result.failures).toBe(1);
    expect(result.redriven).toBe(2);
    expect(result.processed).toBe(3);
  });

  it("forwards the actor to every redrive it issues", async () => {
    countGasInbox.mockResolvedValue(counts(1));
    gasInboxIds.mockResolvedValue(["gi-0"]);

    await call({ actor: "donatas" });

    expect(redriveGasInbox).toHaveBeenCalledWith("gi-0", { by: "donatas" });
  });

  it("forwards the actor to Caseworking too", async () => {
    countCwInbox.mockResolvedValue(cwCounts(1));
    findCwDeadLetterIds.mockResolvedValueOnce(["cw-0"]);

    await call({ service: "caseworking", actor: "donatas" });

    expect(redriveCwEvent).toHaveBeenCalledWith("inbox", "cw-0", {
      by: "donatas",
    });
  });

  it("breaks the answer down per source", async () => {
    countGasInbox.mockResolvedValue(counts(2));
    gasInboxIds.mockResolvedValue(ids(2, "gi"));
    countGasOutbox.mockResolvedValue(counts(1));
    gasOutboxIds.mockResolvedValue(["go-0"]);

    const { perSource } = await call({ service: "gas" });

    expect(perSource.gasInbox).toEqual({
      matched: 2,
      processed: 2,
      redriven: 2,
      conflicts: 0,
      failures: 0,
    });
    expect(perSource.gasOutbox.matched).toBe(1);
  });

  it("degrades rather than fails when a Caseworking box is unreachable", async () => {
    countGasInbox.mockResolvedValue(counts(1));
    gasInboxIds.mockResolvedValue(["gi-0"]);
    countCwInbox.mockRejectedValue(Boom.badGateway("down"));

    const { redriven, sourceErrors } = await call();

    expect(redriven).toBe(1);
    expect(sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "HTTP 502" },
    ]);
  });

  it("is a 502 when both GAS boxes fail", async () => {
    countGasInbox.mockRejectedValue(new Error("down"));
    countGasOutbox.mockRejectedValue(new Error("down"));

    await expect(call()).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
  });

  it("never calls Caseworking with service=gas", async () => {
    await call({ service: "gas" });

    expect(countCwInbox).not.toHaveBeenCalled();
    expect(findCwDeadLetterIds).not.toHaveBeenCalled();
  });
});

describe("redriveQueryUseCase audit", () => {
  it("writes exactly ONE audit event for the whole call, not one per row", async () => {
    countGasInbox.mockResolvedValue(counts(3));
    gasInboxIds.mockResolvedValue(ids(3, "gi"));

    await call();

    expect(writeAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("records the filter, the actor and the counts", async () => {
    countGasInbox.mockResolvedValue(counts(2));
    gasInboxIds.mockResolvedValue(ids(2, "gi"));

    await call({ q: "GLD-9B2", error: "boom", actor: "donatas", limit: 10 });

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCESS",
        entities: [
          {
            entity: auditEntities.EVENT,
            action: auditActions.REDRIVE_EVENTS,
            entityid: "redrive-query",
          },
        ],
        details: expect.objectContaining({
          filter: expect.objectContaining({
            q: "GLD-9B2",
            error: "boom",
            limit: 10,
          }),
          caller: "admin-ui",
          actor: "donatas",
          matched: 2,
          processed: 2,
          redriven: 2,
        }),
      }),
      undefined,
    );
  });

  it("still audits, as a FAILURE, when the call itself failed", async () => {
    countGasInbox.mockRejectedValue(new Error("down"));
    countGasOutbox.mockRejectedValue(new Error("down"));

    await call().catch(() => {});

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAILURE",
        details: expect.objectContaining({ matched: 0, redriven: 0 }),
      }),
      null,
    );
  });
});
