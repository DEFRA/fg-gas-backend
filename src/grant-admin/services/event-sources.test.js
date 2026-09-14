import { describe, expect, it, vi } from "vitest";
import {
  CASEWORKING,
  GAS,
  cwPageFor,
  sectionOfCwPage,
} from "./event-sources.js";

vi.mock("../../common/logger.js");

const cwBox = (overrides = {}) => ({
  list: {
    data: [{ _id: "665f1c2e9a1b2c3d4e5f6a7b" }],
    pagination: {
      startCursor: "a",
      endCursor: "b",
      hasNextPage: false,
      hasPreviousPage: false,
    },
  },
  facets: {
    counts: {
      PUBLISHED: 1,
      PROCESSING: 0,
      FAILED: 0,
      RESUBMITTED: 0,
      COMPLETED: 0,
      DEAD_LETTER: 2,
    },
  },
  groups: [{ error: "No handler found", type: "case.create", count: 2 }],
  ...overrides,
});

const cwPage = (overrides = {}) => ({
  inbox: cwBox(),
  outbox: cwBox(),
  ...overrides,
});

const gasSource = { key: "gasInbox", service: GAS, box: "inbox" };
const cwSource = { key: "cwInbox", service: CASEWORKING, box: "inbox" };

describe("sectionOfCwPage", () => {
  it("answers with the box's own slice of the shared page", async () => {
    const page = cwPage();

    expect(await sectionOfCwPage(page, "inbox", "list")).toBe(page.inbox.list);
    expect(await sectionOfCwPage(page, "outbox", "facets")).toBe(
      page.outbox.facets,
    );
    expect(await sectionOfCwPage(page, "inbox", "groups")).toBe(
      page.inbox.groups,
    );
  });

  it("waits for a read that is still in flight", async () => {
    const page = cwPage();

    expect(await sectionOfCwPage(Promise.resolve(page), "inbox", "list")).toBe(
      page.inbox.list,
    );
  });

  // A partial answer is a gap, not an empty one: turning the null back into a
  // rejection is what makes it the same `sourceError` a failed request was.
  it("throws a 502 naming the box and the section Caseworking could not read", async () => {
    const page = cwPage({ inbox: cwBox({ facets: null }) });

    await expect(
      sectionOfCwPage(page, "inbox", "facets"),
    ).rejects.toMatchObject({
      output: { statusCode: 502 },
      message: "caseworking inbox facets unavailable",
    });
  });

  it("throws when Caseworking answered with no such box at all", async () => {
    await expect(
      sectionOfCwPage(cwPage({ outbox: undefined }), "outbox", "list"),
    ).rejects.toMatchObject({ output: { statusCode: 502 } });
  });

  // The read itself failing is reported by the fan-out around it, once per
  // box, so the rejection travels on unchanged.
  it("lets the read's own rejection through untouched", async () => {
    const error = new Error("socket hang up");

    await expect(
      sectionOfCwPage(Promise.reject(error), "inbox", "list"),
    ).rejects.toBe(error);
  });

  it("keeps an empty answer as an answer rather than a gap", async () => {
    const page = cwPage({ inbox: cwBox({ groups: [] }) });

    expect(await sectionOfCwPage(page, "inbox", "groups")).toEqual([]);
  });
});

describe("cwPageFor", () => {
  it("hands back the read the caller already started", () => {
    const shared = Promise.resolve(cwPage());
    const read = vi.fn();

    expect(cwPageFor([gasSource, cwSource], shared, read)).toBe(shared);
    expect(read).not.toHaveBeenCalled();
  });

  it("starts a read of its own when nobody shared one", () => {
    const own = Promise.resolve(cwPage());
    const read = vi.fn(() => own);

    expect(cwPageFor([gasSource, cwSource], undefined, read)).toBe(own);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads nothing at all when no Caseworking source is selected", () => {
    const read = vi.fn();

    expect(cwPageFor([gasSource], undefined, read)).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it("reads nothing even when a page was shared, if no Caseworking source is selected", () => {
    const read = vi.fn();

    expect(cwPageFor([], Promise.resolve(cwPage()), read)).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
});
