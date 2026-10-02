import { describe, expect, it, vi } from "vitest";
import {
  findCwPage,
  isCwConfigured,
} from "../repositories/cw-actuators.repository.js";
import {
  CASEWORKING,
  GAS,
  readCaseworkingPage,
  sectionOfCwPage,
  serviceScope,
  toPublicSourceErrors,
} from "./event-sources.js";

vi.mock("../../common/logger.js");
vi.mock("../repositories/cw-actuators.repository.js");

const cwBox = (overrides = {}) => ({
  list: {
    data: [{ _id: "665f1c2e9a1b2c3d4e5f6a7b" }],
    pagination: { endCursor: "b", hasNextPage: false },
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

describe("toPublicSourceErrors", () => {
  const lost = (key, service, box) => ({ key, service, box });

  it("names each lost source once, by its words alone, in the fixed order", () => {
    expect(
      toPublicSourceErrors(
        [lost("cwOutbox", CASEWORKING, "outbox")],
        [
          lost("gasInbox", GAS, "inbox"),
          lost("cwOutbox", CASEWORKING, "outbox"),
        ],
        [lost("cwInbox", CASEWORKING, "inbox")],
      ),
    ).toEqual([
      { hop: "GAS Inbox" },
      { hop: "CW-BE Inbox" },
      { hop: "CW-BE Outbox" },
    ]);
  });

  it("is empty when no section lost anything", () => {
    expect(toPublicSourceErrors([], [])).toEqual([]);
  });
});

describe("serviceScope", () => {
  it("names the chosen service, or every service when none was chosen", () => {
    expect(serviceScope("gas")).toBe("gas");
    expect(serviceScope(undefined)).toBe("every service");
  });
});

describe("readCaseworkingPage", () => {
  it("reads the named sections of one Caseworking page with the filters", async () => {
    isCwConfigured.mockReturnValue(true);
    findCwPage.mockResolvedValue({});

    const page = readCaseworkingPage({
      q: "ref-1",
      audit: "exclude",
      sections: ["list"],
    });

    expect(await page).toEqual({});
    expect(findCwPage).toHaveBeenCalledWith({
      q: "ref-1",
      audit: "exclude",
      slices: {
        gasInbox: null,
        gasOutbox: null,
        cwInbox: null,
        cwOutbox: null,
      },
      pageSize: 20,
      sections: ["list"],
    });
  });

  it("reads nothing for a GAS-only filter, or with Caseworking unconfigured", () => {
    isCwConfigured.mockReturnValue(true);
    expect(readCaseworkingPage({ service: GAS, sections: ["list"] })).toBe(
      undefined,
    );

    isCwConfigured.mockReturnValue(false);
    expect(readCaseworkingPage({ sections: ["list"] })).toBe(undefined);
    expect(findCwPage).not.toHaveBeenCalled();
  });

  it("never leaves a failed read unhandled", async () => {
    isCwConfigured.mockReturnValue(true);
    findCwPage.mockRejectedValue(new Error("down"));

    const page = readCaseworkingPage({ sections: ["list"] });

    await expect(page).rejects.toThrow("down");
  });
});
