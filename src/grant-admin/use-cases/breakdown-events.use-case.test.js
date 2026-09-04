import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { breakdown as breakdownGasInbox } from "../../grants/repositories/inbox.repository.js";
import { breakdown as breakdownGasOutbox } from "../../grants/repositories/outbox.repository.js";
import {
  breakdownCwInbox,
  breakdownCwOutbox,
  isCwConfigured,
} from "../repositories/cw-actuators.repository.js";

vi.mock("../../common/logger.js");
vi.mock("../../grants/repositories/inbox.repository.js", () => ({
  breakdown: vi.fn(),
}));
vi.mock("../../grants/repositories/outbox.repository.js", () => ({
  breakdown: vi.fn(),
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
    breakdownCwInbox: vi.fn(),
    breakdownCwOutbox: vi.fn(),
    isCwConfigured: vi.fn(),
  }),
);

const { breakdownEventsUseCase } =
  await import("./breakdown-events.use-case.js");

const aGroup = (overrides = {}) => ({
  error: "No handler found",
  type: "cloud.defra.prd.fg-gas-backend.case.create",
  count: 1,
  firstAt: "2026-06-16T10:00:00.000Z",
  lastAt: "2026-06-16T11:00:00.000Z",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  isCwConfigured.mockReturnValue(true);
  breakdownGasInbox.mockResolvedValue([]);
  breakdownGasOutbox.mockResolvedValue([]);
  breakdownCwInbox.mockResolvedValue([]);
  breakdownCwOutbox.mockResolvedValue([]);
});

describe("breakdownEventsUseCase", () => {
  it("fans out over all four sources with exactly the counts filter", async () => {
    const filter = {
      q: "GLD-9B2",
      from: "2026-06-16T00:00:00.000Z",
      to: "2026-06-16T23:59:59.999Z",
    };

    await breakdownEventsUseCase(filter);

    for (const source of [
      breakdownGasInbox,
      breakdownGasOutbox,
      breakdownCwInbox,
      breakdownCwOutbox,
    ]) {
      expect(source).toHaveBeenCalledWith(filter);
    }
  });

  it("never passes a status - the DEAD_LETTER scope is pinned per source", async () => {
    await breakdownEventsUseCase({});

    expect(breakdownGasInbox.mock.calls[0][0]).not.toHaveProperty("status");
  });

  it("merges the same failure across sources into one group, shortened for display", async () => {
    breakdownGasInbox.mockResolvedValue([aGroup({ count: 3 })]);
    breakdownCwOutbox.mockResolvedValue([
      aGroup({
        type: "cloud.defra.local.fg-cw-backend.case.create",
        count: 4,
      }),
    ]);

    const { groups } = await breakdownEventsUseCase({});

    expect(groups).toEqual([
      {
        error: "No handler found",
        type: "case.create",
        count: 7,
        firstAt: "2026-06-16T10:00:00.000Z",
        lastAt: "2026-06-16T11:00:00.000Z",
      },
    ]);
  });

  it("sorts commonest first and caps the answer at twenty groups", async () => {
    breakdownGasInbox.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) =>
        aGroup({ error: `error-${index}`, count: index + 1 }),
      ),
    );

    const { groups } = await breakdownEventsUseCase({});

    expect(groups).toHaveLength(20);
    expect(groups[0].count).toBe(30);
  });

  it("keeps a null-error group - a row can die before any error is recorded", async () => {
    breakdownGasInbox.mockResolvedValue([aGroup({ error: null })]);

    const { groups } = await breakdownEventsUseCase({});

    expect(groups[0].error).toBeNull();
  });

  it("reads only GAS with service=gas, and never calls Caseworking", async () => {
    await breakdownEventsUseCase({ service: "gas" });

    expect(breakdownGasInbox).toHaveBeenCalled();
    expect(breakdownCwInbox).not.toHaveBeenCalled();
  });

  it("reads only Caseworking with service=caseworking", async () => {
    await breakdownEventsUseCase({ service: "caseworking" });

    expect(breakdownGasInbox).not.toHaveBeenCalled();
    expect(breakdownCwInbox).toHaveBeenCalled();
  });

  it("degrades rather than fails when a Caseworking box is down", async () => {
    breakdownGasInbox.mockResolvedValue([aGroup({ count: 2 })]);
    breakdownCwInbox.mockRejectedValue(Boom.badGateway("nope"));

    const { groups, sourceErrors } = await breakdownEventsUseCase({});

    expect(groups[0].count).toBe(2);
    expect(sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "HTTP 502" },
    ]);
  });

  it("reports Caseworking as not configured rather than calling it", async () => {
    isCwConfigured.mockReturnValue(false);

    const { sourceErrors } = await breakdownEventsUseCase({});

    expect(breakdownCwInbox).not.toHaveBeenCalled();
    expect(sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "not configured" },
      { service: "caseworking", box: "outbox", message: "not configured" },
    ]);
  });

  it("is a 502 when both GAS boxes fail - half a breakdown is not a breakdown", async () => {
    breakdownGasInbox.mockRejectedValue(new Error("down"));
    breakdownGasOutbox.mockRejectedValue(new Error("down"));

    await expect(breakdownEventsUseCase({})).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
  });

  it("answers with no groups and no errors for an empty selection", async () => {
    expect(await breakdownEventsUseCase({})).toEqual({
      groups: [],
      sourceErrors: [],
    });
  });
});
