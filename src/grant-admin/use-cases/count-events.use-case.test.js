import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { countFacets as countGasInbox } from "../../grants/repositories/inbox.repository.js";
import { countFacets as countGasOutbox } from "../../grants/repositories/outbox.repository.js";
import {
  findCwPage,
  isCwConfigured,
} from "../repositories/cw-actuators.repository.js";

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
    findCwPage: vi.fn(),
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

// This use case reads the `facets` section of each box.
const cwBox = (statusCounts) => ({
  list: {
    data: [],
    pagination: {
      startCursor: null,
      endCursor: null,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  },
  facets: statusCounts === null ? null : facets(statusCounts),
  groups: [],
});

const cwPage = ({
  inbox = counts({ DEAD_LETTER: 3 }),
  outbox = counts({ COMPLETED: 4 }),
} = {}) => ({ inbox: cwBox(inbox), outbox: cwBox(outbox) });

const cwCall = () => findCwPage.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  isCwConfigured.mockReturnValue(true);
  countGasInbox.mockResolvedValue(facets(counts({ PUBLISHED: 1 })));
  countGasOutbox.mockResolvedValue(facets(counts({ FAILED: 2 })));
  findCwPage.mockResolvedValue(cwPage());
});

describe("countEventsUseCase", () => {
  it("sums the four sources into one set of counts", async () => {
    expect(await countEventsUseCase({})).toEqual({
      counts: counts({ PUBLISHED: 1, FAILED: 2, DEAD_LETTER: 3, COMPLETED: 4 }),
      sourceErrors: [],
    });
  });

  it("always answers with every status", async () => {
    const { counts: result } = await countEventsUseCase({});

    expect(Object.keys(result)).toEqual([
      "PUBLISHED",
      "PROCESSING",
      "FAILED",
      "RESUBMITTED",
      "COMPLETED",
      "DEAD_LETTER",
    ]);
  });

  it("passes q, error, from and to to every source", async () => {
    const filter = {
      q: "GLD-9B2",
      error: "boom",
      from: "2026-06-16T00:00:00.000Z",
      to: "2026-06-16T23:59:59.999Z",
    };

    await countEventsUseCase(filter);

    for (const count of [countGasInbox, countGasOutbox]) {
      expect(count).toHaveBeenCalledWith(expect.objectContaining(filter));
    }
    expect(cwCall()).toEqual(expect.objectContaining(filter));
  });

  it("reads Caseworking once for both of its boxes, and never narrows by status", async () => {
    await countEventsUseCase({});

    expect(findCwPage).toHaveBeenCalledTimes(1);
    expect(cwCall()).toEqual({
      q: undefined,
      error: undefined,
      from: undefined,
      to: undefined,
      audit: undefined,
      pageSize: 1,
      direction: "forward",
    });
    expect(cwCall()).not.toHaveProperty("status");
  });

  it("reads the Caseworking page the caller shared rather than starting its own", async () => {
    const shared = Promise.resolve(cwPage());

    const { counts: result } = await countEventsUseCase({
      caseworking: shared,
    });

    expect(findCwPage).not.toHaveBeenCalled();
    expect(result).toEqual(
      counts({ PUBLISHED: 1, FAILED: 2, DEAD_LETTER: 3, COMPLETED: 4 }),
    );
  });

  it("never passes service down to a source - it is not a per-source filter", async () => {
    await countEventsUseCase({ service: "gas", q: "x" });

    expect(countGasInbox).toHaveBeenCalledWith({
      q: "x",
      error: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it("never passes service to Caseworking either", async () => {
    await countEventsUseCase({ service: "caseworking", q: "x" });

    expect(cwCall()).not.toHaveProperty("service");
  });

  it("counts only GAS into counts with service=gas", async () => {
    const { counts: result } = await countEventsUseCase({
      service: "gas",
    });

    expect(result).toEqual(counts({ PUBLISHED: 1, FAILED: 2 }));
  });

  it("counts only Caseworking into counts with service=caseworking", async () => {
    expect(
      (await countEventsUseCase({ service: "caseworking" })).counts,
    ).toEqual(counts({ DEAD_LETTER: 3, COMPLETED: 4 }));
  });

  it("answers with counts and sourceErrors and nothing else", async () => {
    const result = await countEventsUseCase({});

    expect(result).not.toHaveProperty("total");
    expect(result).not.toHaveProperty("byService");
    expect(result).not.toHaveProperty("byKind");
    expect(Object.keys(result).sort()).toEqual(["counts", "sourceErrors"]);
  });

  it("never reads Caseworking under service=gas", async () => {
    await countEventsUseCase({ service: "gas" });

    expect(countGasInbox).toHaveBeenCalled();
    expect(countGasOutbox).toHaveBeenCalled();
    expect(findCwPage).not.toHaveBeenCalled();
  });

  it("never reads GAS under service=caseworking", async () => {
    await countEventsUseCase({ service: "caseworking" });

    expect(findCwPage).toHaveBeenCalled();
    expect(countGasInbox).not.toHaveBeenCalled();
    expect(countGasOutbox).not.toHaveBeenCalled();
  });

  it("contributes zeros for a Caseworking box whose counts arrived missing", async () => {
    findCwPage.mockResolvedValue(cwPage({ inbox: null }));

    const result = await countEventsUseCase({});

    expect(result.counts).toEqual(
      counts({ PUBLISHED: 1, FAILED: 2, COMPLETED: 4 }),
    );
    expect(result.sourceErrors).toEqual([
      {
        service: "caseworking",
        box: "inbox",
        hop: "CW Inbox",
        message: "HTTP 502",
      },
    ]);
  });

  it("contributes zeros for both Caseworking boxes when the read times out", async () => {
    findCwPage.mockRejectedValue(Boom.gatewayTimeout("slow"));

    const result = await countEventsUseCase({});

    expect(result.counts).toEqual(counts({ PUBLISHED: 1, FAILED: 2 }));
    expect(result.sourceErrors).toEqual([
      {
        service: "caseworking",
        box: "inbox",
        hop: "CW Inbox",
        message: "timeout",
      },
      {
        service: "caseworking",
        box: "outbox",
        hop: "CW Outbox",
        message: "timeout",
      },
    ]);
  });

  it("reports both Caseworking boxes when Caseworking is down", async () => {
    findCwPage.mockRejectedValue(Boom.badGateway("down"));

    const result = await countEventsUseCase({});

    expect(result.counts).toEqual(counts({ PUBLISHED: 1, FAILED: 2 }));
    expect(result.sourceErrors).toEqual([
      {
        service: "caseworking",
        box: "inbox",
        hop: "CW Inbox",
        message: "HTTP 502",
      },
      {
        service: "caseworking",
        box: "outbox",
        hop: "CW Outbox",
        message: "HTTP 502",
      },
    ]);
  });

  it("reports Caseworking as not configured rather than calling it", async () => {
    isCwConfigured.mockReturnValue(false);

    const result = await countEventsUseCase({});

    expect(result.counts).toEqual(counts({ PUBLISHED: 1, FAILED: 2 }));
    expect(findCwPage).not.toHaveBeenCalled();
    expect(result.sourceErrors).toEqual([
      {
        service: "caseworking",
        box: "inbox",
        hop: "CW Inbox",
        message: "not configured",
      },
      {
        service: "caseworking",
        box: "outbox",
        hop: "CW Outbox",
        message: "not configured",
      },
    ]);
  });

  it("reports no Caseworking sourceError under service=gas", async () => {
    isCwConfigured.mockReturnValue(false);

    const { counts: result, sourceErrors } = await countEventsUseCase({
      service: "gas",
    });

    expect(result).toEqual(counts({ PUBLISHED: 1, FAILED: 2 }));
    expect(sourceErrors).toEqual([]);
  });

  it("reports a Caseworking sourceError with no service filter", async () => {
    isCwConfigured.mockReturnValue(false);

    const { sourceErrors } = await countEventsUseCase({});

    expect(sourceErrors).toEqual([
      {
        service: "caseworking",
        box: "inbox",
        hop: "CW Inbox",
        message: "not configured",
      },
      {
        service: "caseworking",
        box: "outbox",
        hop: "CW Outbox",
        message: "not configured",
      },
    ]);
  });

  it("still answers when one GAS box fails", async () => {
    countGasOutbox.mockRejectedValue(new Error("mongo down"));

    const result = await countEventsUseCase({});

    expect(result.counts).toEqual(
      counts({ PUBLISHED: 1, DEAD_LETTER: 3, COMPLETED: 4 }),
    );
    expect(result.sourceErrors).toContainEqual({
      service: "gas",
      box: "outbox",
      hop: "GAS Outbox",
      message: "read failed",
    });
  });

  it("fails with a 502 when both GAS boxes are unreadable", async () => {
    countGasInbox.mockRejectedValue(new Error("mongo down"));
    countGasOutbox.mockRejectedValue(new Error("mongo down"));

    await expect(countEventsUseCase({})).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
  });

  it("does not 502 on unreadable GAS boxes when only Caseworking was asked for", async () => {
    countGasInbox.mockRejectedValue(new Error("mongo down"));
    countGasOutbox.mockRejectedValue(new Error("mongo down"));

    const result = await countEventsUseCase({ service: "caseworking" });

    expect(result.counts).toEqual(counts({ DEAD_LETTER: 3, COMPLETED: 4 }));
    expect(result.sourceErrors).toEqual([]);
  });

  it("orders sourceErrors by the fixed source order", async () => {
    countGasInbox.mockRejectedValue(new Error("mongo down"));
    findCwPage.mockResolvedValue(cwPage({ outbox: null }));

    const { sourceErrors } = await countEventsUseCase({});

    expect(
      sourceErrors.map((error) => `${error.service}/${error.box}`),
    ).toEqual(["gas/inbox", "caseworking/outbox"]);
  });
});
