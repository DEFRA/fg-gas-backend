import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { countFacets as countGasInbox } from "../../grants/repositories/inbox.repository.js";
import { countFacets as countGasOutbox } from "../../grants/repositories/outbox.repository.js";
import {
  countCwInbox,
  countCwOutbox,
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
    countCwInbox: vi.fn(),
    countCwOutbox: vi.fn(),
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
  PARKED: 0,
};

const counts = (overrides) => ({ ...ZERO, ...overrides });

const facets = (statusCounts) => ({ counts: statusCounts });

beforeEach(() => {
  vi.clearAllMocks();
  isCwConfigured.mockReturnValue(true);
  countGasInbox.mockResolvedValue(facets(counts({ PUBLISHED: 1 })));
  countGasOutbox.mockResolvedValue(facets(counts({ FAILED: 2 })));
  countCwInbox.mockResolvedValue(facets(counts({ DEAD_LETTER: 3 })));
  countCwOutbox.mockResolvedValue(facets(counts({ COMPLETED: 4 })));
});

describe("countEventsUseCase", () => {
  it("sums the four sources into one set of counts", async () => {
    expect(await countEventsUseCase({})).toEqual({
      counts: counts({ PUBLISHED: 1, FAILED: 2, DEAD_LETTER: 3, COMPLETED: 4 }),
      sourceErrors: [],
    });
  });

  it("always answers with every status, PARKED included", async () => {
    const { counts: result } = await countEventsUseCase({});

    expect(Object.keys(result)).toEqual([
      "PUBLISHED",
      "PROCESSING",
      "FAILED",
      "RESUBMITTED",
      "COMPLETED",
      "DEAD_LETTER",
      "PARKED",
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

    for (const count of [
      countGasInbox,
      countGasOutbox,
      countCwInbox,
      countCwOutbox,
    ]) {
      expect(count).toHaveBeenCalledWith(filter);
    }
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

  // One block and its errors. `total` was the seven numbers in `counts` added
  // up and sent beside them; the caller adds them up now. The two
  // service-shaped blocks went before it.
  it("answers with counts and sourceErrors and nothing else", async () => {
    const result = await countEventsUseCase({});

    expect(result).not.toHaveProperty("total");
    expect(result).not.toHaveProperty("byService");
    expect(result).not.toHaveProperty("byKind");
    expect(Object.keys(result).sort()).toEqual(["counts", "sourceErrors"]);
  });

  // The endpoint used to read all four sources whatever `service` said,
  // because `byService` had to answer for the service the operator did NOT
  // select. With that block gone the reason went with it, and counting a
  // service nobody asked about is a collection scan for a number nothing
  // renders. The list has always selected this way; the two now agree.
  it("never reads Caseworking under service=gas", async () => {
    await countEventsUseCase({ service: "gas" });

    expect(countGasInbox).toHaveBeenCalled();
    expect(countGasOutbox).toHaveBeenCalled();
    expect(countCwInbox).not.toHaveBeenCalled();
    expect(countCwOutbox).not.toHaveBeenCalled();
  });

  it("never reads GAS under service=caseworking", async () => {
    await countEventsUseCase({ service: "caseworking" });

    expect(countCwInbox).toHaveBeenCalled();
    expect(countGasInbox).not.toHaveBeenCalled();
    expect(countGasOutbox).not.toHaveBeenCalled();
  });

  it("contributes zeros for a Caseworking box that failed", async () => {
    countCwInbox.mockRejectedValue(Boom.gatewayTimeout("slow"));

    const result = await countEventsUseCase({});

    expect(result.counts).toEqual(
      counts({ PUBLISHED: 1, FAILED: 2, COMPLETED: 4 }),
    );
    expect(result.sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "timeout" },
    ]);
  });

  it("reports both Caseworking boxes when both are down", async () => {
    countCwInbox.mockRejectedValue(Boom.badGateway("down"));
    countCwOutbox.mockRejectedValue(Boom.badGateway("down"));

    const result = await countEventsUseCase({});

    expect(result.counts).toEqual(counts({ PUBLISHED: 1, FAILED: 2 }));
    expect(result.sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "HTTP 502" },
      { service: "caseworking", box: "outbox", message: "HTTP 502" },
    ]);
  });

  it("reports Caseworking as not configured rather than calling it", async () => {
    isCwConfigured.mockReturnValue(false);

    const result = await countEventsUseCase({});

    expect(result.counts).toEqual(counts({ PUBLISHED: 1, FAILED: 2 }));
    expect(countCwInbox).not.toHaveBeenCalled();
    expect(result.sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "not configured" },
      { service: "caseworking", box: "outbox", message: "not configured" },
    ]);
  });

  // Back in step with the list, which has always selected this way: under
  // `?service=gas` Caseworking is not being counted, so an unreadable
  // Caseworking is not a gap in this answer and is not reported as one.
  it("reports no Caseworking sourceError under service=gas", async () => {
    isCwConfigured.mockReturnValue(false);

    const { counts: result, sourceErrors } = await countEventsUseCase({
      service: "gas",
    });

    expect(result).toEqual(counts({ PUBLISHED: 1, FAILED: 2 }));
    expect(sourceErrors).toEqual([]);
  });

  // ...and it is still reported when Caseworking IS part of the answer.
  it("reports a Caseworking sourceError with no service filter", async () => {
    isCwConfigured.mockReturnValue(false);

    const { sourceErrors } = await countEventsUseCase({});

    expect(sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "not configured" },
      { service: "caseworking", box: "outbox", message: "not configured" },
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

  // GAS is not what `service=caseworking` asked about, and is not read at all
  // now, so an unreadable GAS cannot 502 that page.
  it("does not 502 on unreadable GAS boxes when only Caseworking was asked for", async () => {
    countGasInbox.mockRejectedValue(new Error("mongo down"));
    countGasOutbox.mockRejectedValue(new Error("mongo down"));

    const result = await countEventsUseCase({ service: "caseworking" });

    expect(result.counts).toEqual(counts({ DEAD_LETTER: 3, COMPLETED: 4 }));
    expect(result.sourceErrors).toEqual([]);
  });

  it("orders sourceErrors by the fixed source order", async () => {
    countGasInbox.mockRejectedValue(new Error("mongo down"));
    countCwOutbox.mockRejectedValue(Boom.badGateway("down"));

    const { sourceErrors } = await countEventsUseCase({});

    expect(
      sourceErrors.map((error) => `${error.service}/${error.box}`),
    ).toEqual(["gas/inbox", "caseworking/outbox"]);
  });
});
