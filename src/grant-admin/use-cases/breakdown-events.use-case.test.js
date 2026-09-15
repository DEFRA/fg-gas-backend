import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { breakdown as breakdownGasInbox } from "../../grants/repositories/inbox.repository.js";
import { breakdown as breakdownGasOutbox } from "../../grants/repositories/outbox.repository.js";
import { isCwConfigured } from "../repositories/cw-actuators.repository.js";

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

const cwBox = (groups) => ({
  list: { data: [], pagination: { endCursor: null, hasNextPage: false } },
  facets: {
    counts: {
      PUBLISHED: 0,
      PROCESSING: 0,
      FAILED: 0,
      RESUBMITTED: 0,
      COMPLETED: 0,
      DEAD_LETTER: 0,
    },
  },
  groups,
});

const cwPage = ({ inbox = [], outbox = [] } = {}) =>
  Promise.resolve({ inbox: cwBox(inbox), outbox: cwBox(outbox) });

// Handled up front, as the page does, so a rejection the test expects is not unhandled.
const cwFailure = (error) => {
  const page = Promise.reject(error);
  page.catch(() => {});
  return page;
};

const breakdown = (params = {}) =>
  breakdownEventsUseCase({ caseworking: cwPage(), ...params });

beforeEach(() => {
  vi.clearAllMocks();
  isCwConfigured.mockReturnValue(true);
  breakdownGasInbox.mockResolvedValue([]);
  breakdownGasOutbox.mockResolvedValue([]);
});

describe("breakdownEventsUseCase", () => {
  // DEAD_LETTER is pinned per source, and the breakdown already answers `error`.
  it("gives each GAS box q, from, to and audit, and never a status or error", async () => {
    const filter = {
      q: "GLD-9B2",
      from: "2026-06-16T00:00:00.000Z",
      to: "2026-06-16T23:59:59.999Z",
      audit: "include",
    };

    await breakdown({ ...filter, status: "FAILED", error: "boom" });

    for (const source of [breakdownGasInbox, breakdownGasOutbox]) {
      expect(source).toHaveBeenCalledWith(filter);
    }
  });

  it("reads the groups from the shared Caseworking page", async () => {
    const { groups } = await breakdown({
      caseworking: cwPage({ outbox: [aGroup({ count: 4 })] }),
    });

    expect(groups[0].count).toBe(4);
  });

  it("merges the same failure across sources into one group, shortened for display", async () => {
    breakdownGasInbox.mockResolvedValue([aGroup({ count: 3 })]);

    const { groups } = await breakdown({
      caseworking: cwPage({
        outbox: [
          aGroup({
            type: "cloud.defra.local.fg-cw-backend.case.create",
            count: 4,
          }),
        ],
      }),
    });

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

    const { groups } = await breakdown();

    expect(groups).toHaveLength(20);
    expect(groups[0].count).toBe(30);
  });

  it("keeps a null-error group - a row can die before any error is recorded", async () => {
    breakdownGasInbox.mockResolvedValue([aGroup({ error: null })]);

    const { groups } = await breakdown();

    expect(groups[0].error).toBeNull();
  });

  it("reads only GAS with service=gas", async () => {
    breakdownGasInbox.mockResolvedValue([aGroup({ count: 2 })]);

    const answer = await breakdown({
      service: "gas",
      caseworking: cwPage({ outbox: [aGroup({ count: 4 })] }),
    });

    expect(answer.groups[0].count).toBe(2);
    expect(answer.sourceErrors).toEqual([]);
  });

  it("reads only Caseworking with service=caseworking", async () => {
    await breakdown({ service: "caseworking" });

    expect(breakdownGasInbox).not.toHaveBeenCalled();
    expect(breakdownGasOutbox).not.toHaveBeenCalled();
  });

  it("degrades rather than fails when Caseworking is down", async () => {
    breakdownGasInbox.mockResolvedValue([aGroup({ count: 2 })]);

    const answer = await breakdown({
      caseworking: cwFailure(Boom.badGateway("nope")),
    });

    expect(answer.groups[0].count).toBe(2);
    expect(answer.sourceErrors.map((e) => e.key)).toEqual([
      "cwInbox",
      "cwOutbox",
    ]);
  });

  it("reports only the box whose groups Caseworking could not read", async () => {
    breakdownGasInbox.mockResolvedValue([aGroup({ count: 2 })]);

    const answer = await breakdown({ caseworking: cwPage({ inbox: null }) });

    expect(answer.groups[0].count).toBe(2);
    expect(answer.sourceErrors).toEqual([
      { key: "cwInbox", service: "caseworking", box: "inbox" },
    ]);
  });

  it("reports a GAS box whose dead-letter aggregation failed", async () => {
    breakdownGasInbox.mockRejectedValue(
      new Error("operation exceeded time limit"),
    );
    breakdownGasOutbox.mockResolvedValue([aGroup({ count: 2 })]);

    const answer = await breakdown({ service: "gas" });

    expect(answer.groups[0].count).toBe(2);
    expect(answer.sourceErrors).toEqual([
      { key: "gasInbox", service: "gas", box: "inbox" },
    ]);
  });

  it("reports Caseworking as not configured", async () => {
    isCwConfigured.mockReturnValue(false);

    const answer = await breakdown({ caseworking: undefined });

    expect(answer.groups).toEqual([]);
    expect(answer.sourceErrors.map((e) => e.key)).toEqual([
      "cwInbox",
      "cwOutbox",
    ]);
  });

  it("is a 502 when both GAS boxes fail - half a breakdown is not a breakdown", async () => {
    breakdownGasInbox.mockRejectedValue(new Error("down"));
    breakdownGasOutbox.mockRejectedValue(new Error("down"));

    await expect(breakdown()).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
  });

  it("answers with no groups and no source errors when every source is empty", async () => {
    expect(await breakdown()).toEqual({ groups: [], sourceErrors: [] });
  });
});
