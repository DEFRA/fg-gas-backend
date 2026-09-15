import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { countFacets as countGasInbox } from "../../grants/repositories/inbox.repository.js";
import { countFacets as countGasOutbox } from "../../grants/repositories/outbox.repository.js";
import { isCwConfigured } from "../repositories/cw-actuators.repository.js";

vi.mock("../../common/logger.js");
vi.mock("../../grants/repositories/inbox.repository.js", () => ({
  countFacets: vi.fn(),
}));
vi.mock("../../grants/repositories/outbox.repository.js", () => ({
  countFacets: vi.fn(),
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

const { countEventsUseCase } = await import("./count-events.use-case.js");

const ZERO = {
  PUBLISHED: 0,
  PROCESSING: 0,
  FAILED: 0,
  RESUBMITTED: 0,
  COMPLETED: 0,
  DEAD_LETTER: 0,
};

const counts = (overrides) => ({ ...ZERO, ...overrides });

const facets = (statusCounts) => ({ counts: statusCounts });

const cwBox = (statusCounts) => ({
  list: { data: [], pagination: { endCursor: null, hasNextPage: false } },
  facets: statusCounts === null ? null : facets(statusCounts),
  groups: [],
});

const cwPage = ({
  inbox = counts({ DEAD_LETTER: 3 }),
  outbox = counts({ COMPLETED: 4 }),
} = {}) => Promise.resolve({ inbox: cwBox(inbox), outbox: cwBox(outbox) });

// Handled up front, as the page does, so a rejection the test expects is not unhandled.
const cwFailure = (error) => {
  const page = Promise.reject(error);
  page.catch(() => {});
  return page;
};

const count = (params = {}) =>
  countEventsUseCase({ caseworking: cwPage(), ...params });

beforeEach(() => {
  vi.clearAllMocks();
  isCwConfigured.mockReturnValue(true);
  countGasInbox.mockResolvedValue(facets(counts({ PUBLISHED: 1 })));
  countGasOutbox.mockResolvedValue(facets(counts({ FAILED: 2 })));
});

describe("countEventsUseCase", () => {
  it("sums the four sources into one set of counts", async () => {
    expect(await count()).toEqual({
      counts: counts({ PUBLISHED: 1, FAILED: 2, DEAD_LETTER: 3, COMPLETED: 4 }),
      sourceErrors: [],
    });
  });

  it("always answers with every status", async () => {
    const { counts: result } = await count();

    expect(Object.keys(result)).toEqual([
      "PUBLISHED",
      "PROCESSING",
      "FAILED",
      "RESUBMITTED",
      "COMPLETED",
      "DEAD_LETTER",
    ]);
  });

  it("passes q, error, from and to to each GAS box, and never the service", async () => {
    const filter = {
      q: "GLD-9B2",
      error: "boom",
      from: "2026-06-16T00:00:00.000Z",
      to: "2026-06-16T23:59:59.999Z",
    };

    await count({ ...filter, service: "gas" });

    for (const source of [countGasInbox, countGasOutbox]) {
      expect(source).toHaveBeenCalledWith({ ...filter, audit: undefined });
    }
  });

  it("counts only GAS into counts with service=gas", async () => {
    const { counts: result } = await count({ service: "gas" });

    expect(result).toEqual(counts({ PUBLISHED: 1, FAILED: 2 }));
  });

  it("counts only Caseworking, and reads no GAS box, with service=caseworking", async () => {
    const { counts: result } = await count({ service: "caseworking" });

    expect(result).toEqual(counts({ DEAD_LETTER: 3, COMPLETED: 4 }));
    expect(countGasInbox).not.toHaveBeenCalled();
    expect(countGasOutbox).not.toHaveBeenCalled();
  });

  it("answers with counts and sourceErrors", async () => {
    expect(Object.keys(await count()).sort()).toEqual([
      "counts",
      "sourceErrors",
    ]);
  });

  it("contributes zeros for a Caseworking box whose counts arrived missing", async () => {
    const result = await count({ caseworking: cwPage({ inbox: null }) });

    expect(result.counts).toEqual(
      counts({ PUBLISHED: 1, FAILED: 2, COMPLETED: 4 }),
    );
    expect(result.sourceErrors).toEqual([
      { key: "cwInbox", service: "caseworking", box: "inbox" },
    ]);
  });

  it.each([
    ["times out", Boom.gatewayTimeout("slow")],
    ["is down", Boom.badGateway("down")],
  ])(
    "reports both Caseworking boxes when Caseworking %s",
    async (_name, error) => {
      const result = await count({ caseworking: cwFailure(error) });

      expect(result.counts).toEqual(counts({ PUBLISHED: 1, FAILED: 2 }));
      expect(result.sourceErrors).toEqual([
        { key: "cwInbox", service: "caseworking", box: "inbox" },
        { key: "cwOutbox", service: "caseworking", box: "outbox" },
      ]);
    },
  );

  it("reports Caseworking as not configured with no service filter", async () => {
    isCwConfigured.mockReturnValue(false);

    const result = await count({ caseworking: undefined });

    expect(result.counts).toEqual(counts({ PUBLISHED: 1, FAILED: 2 }));
    expect(result.sourceErrors).toEqual([
      { key: "cwInbox", service: "caseworking", box: "inbox" },
      { key: "cwOutbox", service: "caseworking", box: "outbox" },
    ]);
  });

  it("reports no Caseworking sourceError under service=gas", async () => {
    isCwConfigured.mockReturnValue(false);

    const { counts: result, sourceErrors } = await count({
      service: "gas",
      caseworking: undefined,
    });

    expect(result).toEqual(counts({ PUBLISHED: 1, FAILED: 2 }));
    expect(sourceErrors).toEqual([]);
  });

  it("still answers when one GAS box fails", async () => {
    countGasOutbox.mockRejectedValue(new Error("mongo down"));

    const result = await count();

    expect(result.counts).toEqual(
      counts({ PUBLISHED: 1, DEAD_LETTER: 3, COMPLETED: 4 }),
    );
    expect(result.sourceErrors).toContainEqual({
      key: "gasOutbox",
      service: "gas",
      box: "outbox",
    });
  });

  it("fails with a 502 when both GAS boxes are unreadable", async () => {
    countGasInbox.mockRejectedValue(new Error("mongo down"));
    countGasOutbox.mockRejectedValue(new Error("mongo down"));

    await expect(count()).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
  });

  it("does not 502 on unreadable GAS boxes when only Caseworking was asked for", async () => {
    countGasInbox.mockRejectedValue(new Error("mongo down"));
    countGasOutbox.mockRejectedValue(new Error("mongo down"));

    const result = await count({ service: "caseworking" });

    expect(result.counts).toEqual(counts({ DEAD_LETTER: 3, COMPLETED: 4 }));
    expect(result.sourceErrors).toEqual([]);
  });
});
