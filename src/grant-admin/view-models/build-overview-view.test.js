import { describe, expect, it } from "vitest";
import { buildOverviewView } from "./build-overview-view.js";

const CAP = 10;
const WINDOW = {
  from: "2026-10-12T00:00:00.000Z",
  to: "2026-10-13T00:00:00.000Z",
};

// One part as the page shapes it, from what was read for it.
const shape = (part, data) =>
  buildOverviewView({
    at: WINDOW.to,
    window: WINDOW,
    countCap: CAP,
    deadLetters: {},
    topErrors: {},
    configFailed: {},
    tokensExpiring: {},
    [part]: { gas: { data, sourceError: null } },
  })[part].gas.data;

const toDeadLetters = ({ boxes, countCap }) =>
  shape("deadLetters", {
    countCap,
    boxes: boxes.map((bins, i) => ({
      box: ["outbox", "inbox"][i],
      list: { ...LIST, path: `events/gas/${["outbox", "inbox"][i]}` },
      bins,
    })),
  });

const toTopErrors = (summaries) => shape("topErrors", { summaries });

const toConfigFailed = (pages) => shape("configFailed", { pages });

const bins = (counts, capped = []) =>
  counts.map((count, i) => ({
    from: `2026-10-12T${String(i * 2).padStart(2, "0")}:00:00.000Z`,
    to: `2026-10-12T${String(i * 2 + 2).padStart(2, "0")}:00:00.000Z`,
    count,
    capped: capped[i] ?? false,
  }));

const LIST = { path: "events/gas/outbox", query: { status: "DEAD_LETTER" } };

const inWindow = (path) => ({
  path,
  query: { status: "DEAD_LETTER", ...WINDOW },
});

describe("toDeadLetters", () => {
  it("adds the boxes bar by bar, the figure the sum of the bars", () => {
    const answer = toDeadLetters({
      boxes: [bins([1, 0, 2]), bins([3, 0, 0])],
      countCap: CAP,
    });

    expect(answer).toEqual({
      count: 6,
      capped: false,
      bars: bins([4, 0, 2]),
      lists: [
        {
          box: "outbox",
          count: 3,
          capped: false,
          list: inWindow("events/gas/outbox"),
        },
        {
          box: "inbox",
          count: 3,
          capped: false,
          list: inWindow("events/gas/inbox"),
        },
      ],
    });
  });

  it("caps a box's own count, and says so", () => {
    const { lists } = toDeadLetters({
      boxes: [bins([6, 6]), bins([0, 0])],
      countCap: CAP,
    });

    expect(lists[0]).toMatchObject({ count: CAP, capped: true });
    expect(lists[1]).toMatchObject({ count: 0, capped: false });
  });

  it("caps a bar whose boxes add to more than the cap", () => {
    const { bars } = toDeadLetters({
      boxes: [bins([6, 1]), bins([5, 1])],
      countCap: CAP,
    });

    expect(bars.map(({ count, capped }) => [count, capped])).toEqual([
      [10, true],
      [2, false],
    ]);
  });

  it("keeps a box's own cap on its bar", () => {
    const { bars, capped } = toDeadLetters({
      boxes: [bins([CAP, 0], [true]), bins([0, 0])],
      countCap: CAP,
    });

    expect(bars[0]).toMatchObject({ count: CAP, capped: true });
    expect(capped).toBe(true);
  });

  it("caps the figure when the bars add to more than the cap", () => {
    expect(
      toDeadLetters({
        boxes: [bins([6, 6])],
        countCap: CAP,
      }),
    ).toMatchObject({ count: CAP, capped: true });
  });
});

const box = {
  path: "events/gas/inbox",
  params: { status: "status", errorKey: "error", eventType: "event" },
  labels: { CaseStatusUpdated: "Case status updated" },
  among: { status: "DEAD_LETTER" },
};

const entry = (errorKey, eventType, count, lastAt = null) => ({
  values: { errorKey, eventType },
  count,
  capped: false,
  firstAt: null,
  lastAt,
});

const summary = (entries, overrides = {}) => ({
  bucket: "gas.inbox",
  summary: "errors",
  entries,
  more: false,
  complete: true,
  ...overrides,
});

describe("toTopErrors", () => {
  it("links the dead letters that recorded no error by their own key", () => {
    const [top] = toTopErrors([
      {
        box,
        summary: summary([entry("No error recorded", "CaseStatusUpdated", 2)]),
      },
    ]).entries;

    expect(top.list.query).toEqual({
      status: "DEAD_LETTER",
      error: "No error recorded",
      event: "CaseStatusUpdated",
    });
  });

  it("links each group to its list, filtered as the list's URL spells it", () => {
    const { entries } = toTopErrors([
      {
        box,
        summary: summary([
          entry(
            "Status <v> unknown",
            "CaseStatusUpdated",
            3,
            "2026-10-12T10:00:00.000Z",
          ),
        ]),
      },
    ]);

    expect(entries).toEqual([
      {
        errorKey: "Status <v> unknown",
        event: { value: "CaseStatusUpdated", label: "Case status updated" },
        count: 3,
        capped: false,
        lastAt: "2026-10-12T10:00:00.000Z",
        list: {
          path: "events/gas/inbox",
          query: {
            status: "DEAD_LETTER",
            error: "Status <v> unknown",
            event: "CaseStatusUpdated",
          },
        },
      },
    ]);
  });

  it("leaves a value the dead letters hold none of out of the link, and the event unnamed", () => {
    const [top] = toTopErrors([
      { box, summary: summary([entry(null, null, 2)]) },
    ]).entries;

    expect(top.event).toBeNull();
    expect(top.list.query).toEqual({ status: "DEAD_LETTER" });
  });

  it("names an event it has no label for by its value", () => {
    const [top] = toTopErrors([
      { box, summary: summary([entry("x", "Unlabelled", 1)]) },
    ]).entries;

    expect(top.event).toEqual({ value: "Unlabelled", label: "Unlabelled" });
  });

  it("merges the boxes most first, the top five, and says there were more", () => {
    const answer = toTopErrors([
      {
        box,
        summary: summary([entry("a", null, 9), entry("b", null, 1)]),
      },
      {
        box: { ...box, path: "events/gas/outbox" },
        summary: summary([
          entry("c", null, 7),
          entry("d", null, 5),
          entry("e", null, 4),
          entry("f", null, 3),
        ]),
      },
    ]);

    expect(answer.entries.map(({ errorKey }) => errorKey)).toEqual([
      "a",
      "c",
      "d",
      "e",
      "f",
    ]);
    expect(answer.more).toBe(true);
    expect(answer.complete).toBe(true);
  });

  it("puts the latest first among equal counts", () => {
    const answer = toTopErrors([
      {
        box,
        summary: summary([
          entry("old", null, 2, "2026-10-12T01:00:00.000Z"),
          entry("new", null, 2, "2026-10-12T09:00:00.000Z"),
        ]),
      },
    ]);

    expect(answer.entries.map(({ errorKey }) => errorKey)).toEqual([
      "new",
      "old",
    ]);
  });

  it("says there were more, or the counting stopped short, when a summary does", () => {
    expect(
      toTopErrors([
        { box, summary: summary([], { more: true, complete: false }) },
        { box, summary: summary([]) },
      ]),
    ).toEqual({ entries: [], more: true, complete: false });
  });
});

const row = (code, version, time) => ({
  id: "66f000000000000000000001",
  time,
  title: code,
  subtitle: null,
  cells: {},
  link: { kind: "grant", code, version },
});

describe("toConfigFailed", () => {
  it("merges each definition's versions, newest received first", () => {
    expect(
      toConfigFailed([
        {
          definition: "permanent_error",
          rows: [row("woodland", "1.0.0", "2026-10-01T00:00:00.000Z")],
          more: false,
        },
        {
          definition: "transient_error",
          rows: [row("frps", "2.1.0", "2026-10-05T00:00:00.000Z")],
          more: false,
        },
      ]),
    ).toEqual({
      versions: [
        {
          code: "frps",
          version: "2.1.0",
          definition: "transient_error",
          receivedAt: "2026-10-05T00:00:00.000Z",
        },
        {
          code: "woodland",
          version: "1.0.0",
          definition: "permanent_error",
          receivedAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      more: false,
    });
  });

  it("sends the first hundred, and says there are more", () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      row(
        "woodland",
        `1.0.${i}`,
        new Date(Date.UTC(2026, 0, 1, i)).toISOString(),
      ),
    );

    const answer = toConfigFailed([
      { definition: "permanent_error", rows, more: false },
      { definition: "transient_error", rows, more: false },
    ]);

    expect(answer.versions).toHaveLength(100);
    expect(answer.more).toBe(true);
  });

  it("says there are more when a definition's list goes on", () => {
    expect(
      toConfigFailed([{ definition: "permanent_error", rows: [], more: true }])
        .more,
    ).toBe(true);
  });
});

describe("toTokensExpiring", () => {
  it("answers the tokens read without their stored rows", () => {
    const token = { tokenId: "a", status: "EXPIRED", stored: { id: "x" } };

    expect(
      shape("tokensExpiring", { withinDays: 30, tokens: [token] }),
    ).toEqual({
      withinDays: 30,
      tokens: [{ tokenId: "a", status: "EXPIRED" }],
    });
  });
});

describe("buildOverviewView", () => {
  it("passes a part that was not read on as it is", () => {
    const notRead = {
      data: null,
      sourceError: { hop: "CW-BE", reason: "TIMED_OUT" },
    };
    const view = buildOverviewView({
      at: WINDOW.to,
      window: WINDOW,
      countCap: CAP,
      deadLetters: { cw: notRead },
      topErrors: { cw: notRead },
      configFailed: { cw: notRead },
      tokensExpiring: { cw: notRead },
    });

    expect(view).toEqual({
      at: WINDOW.to,
      window: WINDOW,
      countCap: CAP,
      deadLetters: { cw: notRead },
      topErrors: { cw: notRead },
      configFailed: { cw: notRead },
      tokensExpiring: { cw: notRead },
    });
  });
});
