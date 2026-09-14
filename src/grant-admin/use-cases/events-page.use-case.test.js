import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findCwPage } from "../repositories/cw-actuators.repository.js";
import {
  serviceVocabulary,
  statusVocabulary,
} from "../services/event-display.js";
import { breakdownEventsUseCase } from "./breakdown-events.use-case.js";
import { countEventsUseCase } from "./count-events.use-case.js";
import { eventsPageUseCase } from "./events-page.use-case.js";
import { findEventsUseCase } from "./find-events.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("./find-events.use-case.js");
vi.mock("./count-events.use-case.js");
vi.mock("./breakdown-events.use-case.js");
vi.mock(
  "../repositories/cw-actuators.repository.js",
  async (importOriginal) => ({
    ...(await importOriginal()),
    findCwPage: vi.fn(),
  }),
);

const COUNTS = {
  PUBLISHED: 1,
  PROCESSING: 0,
  FAILED: 2,
  RESUBMITTED: 0,
  COMPLETED: 3,
  DEAD_LETTER: 4,
};

const GROUP = {
  error: "No handler found",
  type: "case.status.updated",
  count: 4,
  firstAt: "2026-06-16T10:00:00.000Z",
  lastAt: "2026-06-16T10:30:00.000Z",
};

const listPage = (overrides = {}) => ({
  events: [{ id: "665f1c2e9a1b2c3d4e5f6a7b" }],
  // The same page in the journey's shape, which this response has no use for.
  hops: [{ id: "665f1c2e9a1b2c3d4e5f6a7b" }],
  pagination: {
    startCursor: "start",
    endCursor: "end",
    hasNextPage: true,
    hasPreviousPage: false,
  },
  sourceErrors: [],
  ...overrides,
});

const STATUSES = statusVocabulary();
const SERVICES = serviceVocabulary();

// One box of the composite Caseworking answers the whole page with.
const cwBox = () => ({
  list: {
    data: [],
    pagination: {
      startCursor: null,
      endCursor: null,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  },
  facets: { counts: COUNTS },
  groups: [GROUP],
});

const cwPage = () => ({ inbox: cwBox(), outbox: cwBox() });

// The one Caseworking read the page started, as each section received it.
const sharedReads = () =>
  [findEventsUseCase, countEventsUseCase, breakdownEventsUseCase].map(
    (useCase) => useCase.mock.calls[0][0].caseworking,
  );

const query = (overrides = {}) => ({
  cursor: undefined,
  direction: "forward",
  status: undefined,
  service: undefined,
  q: undefined,
  error: undefined,
  from: undefined,
  to: undefined,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  findCwPage.mockResolvedValue(cwPage());
  findEventsUseCase.mockResolvedValue(listPage());
  countEventsUseCase.mockResolvedValue({
    counts: COUNTS,
    sourceErrors: [],
  });
  breakdownEventsUseCase.mockResolvedValue({
    groups: [GROUP],
    sourceErrors: [],
  });
});

describe("eventsPageUseCase", () => {
  it("answers with the list, the counts and the breakdown in one body", async () => {
    const page = await eventsPageUseCase(query());

    expect(page).toEqual({
      events: [{ id: "665f1c2e9a1b2c3d4e5f6a7b" }],
      pagination: {
        startCursor: "start",
        endCursor: "end",
        hasNextPage: true,
        hasPreviousPage: false,
      },
      statuses: STATUSES,
      services: SERVICES,
      counts: COUNTS,
      breakdown: { groups: [GROUP], sourceErrors: [] },
      sourceErrors: [],
      sectionErrors: [],
    });
  });

  it("answers with exactly the eight documented keys", async () => {
    expect(Object.keys(await eventsPageUseCase(query())).sort()).toEqual([
      "breakdown",
      "counts",
      "events",
      "pagination",
      "sectionErrors",
      "services",
      "sourceErrors",
      "statuses",
    ]);
  });

  it("leaves the journey's shape of the page behind", async () => {
    expect(await eventsPageUseCase(query())).not.toHaveProperty("hops");
  });

  it("carries the toolbar's vocabulary even when both aggregations fail", async () => {
    countEventsUseCase.mockRejectedValue(Boom.badGateway("nope"));
    breakdownEventsUseCase.mockRejectedValue(Boom.badGateway("nope"));

    const page = await eventsPageUseCase(query());

    expect(page.statuses).toEqual(STATUSES);
    expect(page.services).toEqual(SERVICES);
  });

  it("carries only the six numbers as `counts`, not the counts envelope", async () => {
    countEventsUseCase.mockResolvedValue({
      counts: COUNTS,
      sourceErrors: [
        {
          service: "caseworking",
          box: "inbox",
          hop: "CW Inbox",
          message: "timeout",
        },
      ],
    });

    const page = await eventsPageUseCase(query());

    expect(page.counts).toEqual(COUNTS);
    expect(page.counts).not.toHaveProperty("sourceErrors");
  });

  // The counts read the same four sources the list does, but as a separate
  // query: one can lose a source the other kept. Discarding that left a page
  // showing a silently low number with nothing to say why.
  it("names a source the counts lost, even where the list kept its rows", async () => {
    const lost = {
      service: "caseworking",
      box: "inbox",
      hop: "CW Inbox",
      message: "timeout",
    };
    findEventsUseCase.mockResolvedValue(listPage({ sourceErrors: [] }));
    countEventsUseCase.mockResolvedValue({
      counts: COUNTS,
      sourceErrors: [lost],
    });

    const page = await eventsPageUseCase(query());

    expect(page.sourceErrors).toEqual([lost]);
    // Still a page, with its rows and its numbers - degraded, not lost.
    expect(page.events).toEqual(listPage().events);
    expect(page.counts).toEqual(COUNTS);
  });

  it("names a source once when both reads lost it", async () => {
    const fromList = {
      service: "caseworking",
      box: "inbox",
      hop: "CW Inbox",
      message: "timeout",
    };
    findEventsUseCase.mockResolvedValue(
      listPage({ sourceErrors: [fromList] }),
    );
    countEventsUseCase.mockResolvedValue({
      counts: COUNTS,
      sourceErrors: [{ ...fromList, message: "read failed" }],
    });

    const page = await eventsPageUseCase(query());

    expect(page.sourceErrors).toEqual([fromList]);
  });

  it("keeps the fixed source order across both reads", async () => {
    const cwOutbox = {
      service: "caseworking",
      box: "outbox",
      hop: "CW Outbox",
      message: "timeout",
    };
    const gasInbox = {
      service: "gas",
      box: "inbox",
      hop: "GAS Inbox",
      message: "read failed",
    };
    findEventsUseCase.mockResolvedValue(listPage({ sourceErrors: [cwOutbox] }));
    countEventsUseCase.mockResolvedValue({
      counts: COUNTS,
      sourceErrors: [gasInbox],
    });

    const page = await eventsPageUseCase(query());

    expect(page.sourceErrors.map((e) => e.hop)).toEqual([
      "GAS Inbox",
      "CW Outbox",
    ]);
  });

  // A counts section that failed outright is a sectionError; it has no source
  // errors of its own to merge, and the merge must not trip over that.
  it("survives a counts section that failed outright", async () => {
    countEventsUseCase.mockRejectedValue(new Error("counts down"));

    const page = await eventsPageUseCase(query());

    expect(page.counts).toBeNull();
    expect(page.sectionErrors).toEqual([
      { section: "counts", message: "read failed" },
    ]);
    expect(page.sourceErrors).toEqual(listPage().sourceErrors);
  });

  it("carries the breakdown's own sourceErrors inside the breakdown", async () => {
    breakdownEventsUseCase.mockResolvedValue({
      groups: [],
      sourceErrors: [
        { service: "caseworking", box: "outbox", message: "HTTP 500" },
      ],
    });

    const page = await eventsPageUseCase(query());

    expect(page.breakdown.sourceErrors).toEqual([
      { service: "caseworking", box: "outbox", message: "HTTP 500" },
    ]);
    expect(page.sectionErrors).toEqual([]);
  });

  it("passes the list's own sourceErrors straight through", async () => {
    findEventsUseCase.mockResolvedValue(
      listPage({
        sourceErrors: [
          { service: "caseworking", box: "inbox", message: "not configured" },
        ],
      }),
    );

    expect((await eventsPageUseCase(query())).sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "not configured" },
    ]);
  });
});

describe("eventsPageUseCase fan-out", () => {
  const filter = {
    cursor: "abc",
    direction: "backward",
    status: "DEAD_LETTER",
    service: "gas",
    q: "GLD-9B2",
    error: "boom",
    from: "2026-06-16T00:00:00.000Z",
    to: "2026-06-16T23:59:59.999Z",
  };

  it("gives the list every parameter it accepts", async () => {
    await eventsPageUseCase(filter);

    expect(findEventsUseCase).toHaveBeenCalledWith(filter);
  });

  it("gives the counts everything but the cursor and the status it groups by", async () => {
    await eventsPageUseCase(filter);

    expect(countEventsUseCase).toHaveBeenCalledWith({
      service: "gas",
      q: "GLD-9B2",
      error: "boom",
      from: "2026-06-16T00:00:00.000Z",
      to: "2026-06-16T23:59:59.999Z",
    });
  });

  it.each(["include", "exclude"])(
    "gives audit=%s to the rows, the counts and the breakdown alike",
    async (audit) => {
      await eventsPageUseCase(query({ audit }));

      for (const useCase of [
        findEventsUseCase,
        countEventsUseCase,
        breakdownEventsUseCase,
      ]) {
        expect(useCase).toHaveBeenCalledWith(
          expect.objectContaining({ audit }),
        );
      }
    },
  );

  it("gives the breakdown neither the status nor the error filter", async () => {
    await eventsPageUseCase(filter);

    expect(breakdownEventsUseCase).toHaveBeenCalledWith({
      service: "gas",
      q: "GLD-9B2",
      from: "2026-06-16T00:00:00.000Z",
      to: "2026-06-16T23:59:59.999Z",
    });
  });

  it("reads the breakdown even when no status is selected", async () => {
    await eventsPageUseCase(query());

    expect(breakdownEventsUseCase).toHaveBeenCalledTimes(1);
  });

  it("starts all three before waiting on any of them", async () => {
    const started = [];
    const never = (name) =>
      vi.fn(() => {
        started.push(name);

        return new Promise(() => {});
      });

    findEventsUseCase.mockImplementation(never("list"));
    countEventsUseCase.mockImplementation(never("counts"));
    breakdownEventsUseCase.mockImplementation(never("breakdown"));

    eventsPageUseCase(query());
    await Promise.resolve();

    expect(started).toEqual(["list", "counts", "breakdown"]);
  });
});

describe("eventsPageUseCase caseworking read", () => {
  it("reads Caseworking exactly once for a whole page render", async () => {
    await eventsPageUseCase(query());

    expect(findCwPage).toHaveBeenCalledTimes(1);
  });

  it("hands the same read to the list, the counts and the breakdown", async () => {
    await eventsPageUseCase(query());

    const [list, counts, breakdown] = sharedReads();

    expect(list).toBe(findCwPage.mock.results[0].value);
    expect(counts).toBe(list);
    expect(breakdown).toBe(list);
  });

  it("asks for a whole page of rows in both boxes' cursor positions", async () => {
    await eventsPageUseCase(query({ status: "DEAD_LETTER", q: "GLD-9B2" }));

    expect(findCwPage).toHaveBeenCalledWith({
      slices: {
        gasInbox: null,
        gasOutbox: null,
        cwInbox: null,
        cwOutbox: null,
      },
      pageSize: 20,
      direction: "forward",
      status: "DEAD_LETTER",
      q: "GLD-9B2",
      error: undefined,
      from: undefined,
      to: undefined,
      audit: undefined,
    });
  });

  it("makes no Caseworking read at all under service=gas", async () => {
    await eventsPageUseCase(query({ service: "gas" }));

    expect(findCwPage).not.toHaveBeenCalled();
    expect(sharedReads()).toEqual([undefined, undefined, undefined]);
  });

  it("still reads Caseworking under service=caseworking", async () => {
    await eventsPageUseCase(query({ service: "caseworking" }));

    expect(findCwPage).toHaveBeenCalledTimes(1);
  });

  // Every section awaits the read inside its own `Promise.allSettled`, so an
  // outage is drawn as sourceErrors; a section that throws before getting that
  // far must not leave the rejection unhandled.
  it("survives a Caseworking outage without an unhandled rejection", async () => {
    findCwPage.mockRejectedValue(Boom.badGateway("down"));

    const page = await eventsPageUseCase(query());

    expect(page.events).toHaveLength(1);
  });
});

describe("eventsPageUseCase degradation", () => {
  it("nulls the counts and names the section when the counts fail", async () => {
    countEventsUseCase.mockRejectedValue(
      Boom.badGateway("Events could not be loaded from GAS"),
    );

    const page = await eventsPageUseCase(query());

    expect(page.counts).toBeNull();
    expect(page.sectionErrors).toEqual([
      { section: "counts", message: "Events could not be loaded from GAS" },
    ]);
    expect(page.events).toHaveLength(1);
    expect(page.breakdown).toEqual({ groups: [GROUP], sourceErrors: [] });
  });

  it("nulls the breakdown and names the section when the breakdown fails", async () => {
    breakdownEventsUseCase.mockRejectedValue(
      Boom.badGateway("Events could not be loaded from GAS"),
    );

    const page = await eventsPageUseCase(query());

    expect(page.breakdown).toBeNull();
    expect(page.sectionErrors).toEqual([
      { section: "breakdown", message: "Events could not be loaded from GAS" },
    ]);
    expect(page.counts).toEqual(COUNTS);
  });

  it("names both sections, counts first, when both fail", async () => {
    countEventsUseCase.mockRejectedValue(Boom.badGateway("counts gone"));
    breakdownEventsUseCase.mockRejectedValue(Boom.badGateway("breakdown gone"));

    const page = await eventsPageUseCase(query());

    expect(page.counts).toBeNull();
    expect(page.breakdown).toBeNull();
    expect(page.sectionErrors).toEqual([
      { section: "counts", message: "counts gone" },
      { section: "breakdown", message: "breakdown gone" },
    ]);
  });

  it("fails the whole call when the list fails, and keeps its status", async () => {
    findEventsUseCase.mockRejectedValue(
      Boom.badGateway("Events could not be loaded from GAS"),
    );

    await expect(eventsPageUseCase(query())).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
  });

  it("fails the whole call when the list fails even though the sections answered", async () => {
    findEventsUseCase.mockRejectedValue(
      Boom.badRequest("Cannot decode cursor"),
    );

    await expect(
      eventsPageUseCase(query({ cursor: "tampered" })),
    ).rejects.toMatchObject({ output: { statusCode: 400 } });
  });

  it("reports a section failure without ever leaking what a source said", async () => {
    countEventsUseCase.mockRejectedValue(
      new Error("MongoServerError: SECRET-CONNECTION-STRING"),
    );

    const page = await eventsPageUseCase(query());

    expect(page.sectionErrors).toEqual([
      { section: "counts", message: "read failed" },
    ]);
    expect(JSON.stringify(page)).not.toContain("SECRET-CONNECTION-STRING");
  });

  it("masks an unexpected Boom 500 behind the generic message", async () => {
    breakdownEventsUseCase.mockRejectedValue(
      Boom.internal("SECRET-INTERNAL-DETAIL"),
    );

    const page = await eventsPageUseCase(query());

    expect(page.sectionErrors).toEqual([
      { section: "breakdown", message: "An internal server error occurred" },
    ]);
  });
});
