import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import {
  SECTION_CAP_BYTES,
  TOO_LARGE,
  composeRecordPage,
} from "./compose-record-page.js";

vi.mock("../../common/logger.js");

const HEADER = { ref: "ref-1" };
const ACCOUNTS = { sbi: "123456789" };

const readHeader = vi.fn();

const tabs = {
  overview: { readTab: vi.fn(), empty: { overview: null } },
  raw: {
    readTab: vi.fn(),
    empty: { raw: null, storedBytes: null },
    capped: "raw",
  },
};

const compose = (tab) =>
  composeRecordPage({
    readHeader,
    tab: tabs[tab],
    args: { ref: "ref-1", tab },
  });

const view = async (tab) => (await compose(tab)).page;

describe("composeRecordPage", () => {
  beforeEach(() => {
    readHeader.mockResolvedValue({
      header: HEADER,
      accounts: ACCOUNTS,
      sourceErrors: [],
    });
    tabs.overview.readTab.mockResolvedValue({
      content: { overview: { facts: 1 } },
    });
    tabs.raw.readTab.mockResolvedValue({
      content: { raw: { a: 1 }, storedBytes: 10 },
    });
  });

  it("answers the header beside the tab's own keys", async () => {
    expect(await view("overview")).toEqual({
      header: HEADER,
      overview: { facts: 1 },
      sourceErrors: [],
      sectionErrors: [],
    });
  });

  it("reads the header and the tab in parallel", async () => {
    let releaseHeader;
    readHeader.mockReturnValue(
      new Promise((resolve) => {
        releaseHeader = resolve;
      }),
    );

    const page = view("overview");
    await Promise.resolve();

    expect(tabs.overview.readTab).toHaveBeenCalledWith({
      ref: "ref-1",
      tab: "overview",
    });

    releaseHeader({ header: HEADER, accounts: null, sourceErrors: [] });
    await page;
  });

  it("fails the page when the header cannot be read, not-found included", async () => {
    const notFound = Boom.notFound("application not found");
    readHeader.mockRejectedValue(notFound);

    await expect(view("overview")).rejects.toBe(notFound);
  });

  it("answers a tab that could not be read as null beside a section error", async () => {
    tabs.overview.readTab.mockRejectedValue(Boom.badGateway("unavailable"));

    const page = await view("overview");

    expect(page.overview).toBeNull();
    expect(page.sectionErrors).toEqual([
      { section: "overview", message: "unavailable" },
    ]);
  });

  it("answers a capped section over 1 MiB as null, too large to show", async () => {
    tabs.raw.readTab.mockResolvedValue({
      content: { raw: { big: "x".repeat(SECTION_CAP_BYTES) }, storedBytes: 9 },
    });

    const page = await view("raw");

    expect(page.raw).toBeNull();
    expect(page.storedBytes).toBe(9);
    expect(page.sectionErrors).toEqual([
      { section: "raw", message: TOO_LARGE },
    ]);
  });

  it("answers a section its tab already knows is too large as null, too large to show", async () => {
    tabs.raw.readTab.mockResolvedValue({
      content: { raw: null, storedBytes: 9 },
      tooLarge: true,
    });

    const page = await view("raw");

    expect(page.raw).toBeNull();
    expect(page.sectionErrors).toEqual([
      { section: "raw", message: TOO_LARGE },
    ]);
  });

  it("logs a failed tab by its status alone, never the reason it carries", async () => {
    const error = Boom.badGateway("unavailable");
    error.data = { payload: "SECRET-CW-BODY" };
    tabs.overview.readTab.mockRejectedValue(error);

    await view("overview");

    expect(logger.error).toHaveBeenCalledWith(
      "Admin page: overview could not be read (502)",
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("SECRET");
  });

  it("keeps a capped section at or under 1 MiB", async () => {
    expect((await view("raw")).raw).toEqual({ a: 1 });
  });

  it("names each source a read lost, as a hop", async () => {
    tabs.overview.readTab.mockResolvedValue({
      content: { overview: {} },
      sourceErrors: [{ key: "cwInbox", service: "caseworking", box: "inbox" }],
    });

    expect((await view("overview")).sourceErrors).toEqual([
      { hop: "CW-BE Inbox" },
    ]);
  });

  it("answers the header's accounts beside the page, never in it", async () => {
    const { page, accounts } = await compose("overview");

    expect(accounts).toEqual(ACCOUNTS);
    expect(page).not.toHaveProperty("accounts");
  });
});
