import { describe, expect, it, vi } from "vitest";
import { readGrantStatusMap } from "./read-grant-status-map.js";
import { viewGrantVersionPageUseCase } from "./view-grant-version-page.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("./view-grant-version-page.use-case.js");

const LIFECYCLE = { phases: [] };

const aPage = (overrides = {}) => ({
  header: { files: { grant: { stored: true } } },
  lifecycle: LIFECYCLE,
  problem: null,
  sectionErrors: [],
  ...overrides,
});

const read = () =>
  readGrantStatusMap({
    code: "woodland",
    version: "1.2.0",
    caller: "grants-platform-admin",
  });

describe("readGrantStatusMap", () => {
  it("answers the grant's lifecycle, read as a view of its Phases tab", async () => {
    viewGrantVersionPageUseCase.mockResolvedValue(aPage());

    expect(await read()).toEqual({ outcome: "found", lifecycle: LIFECYCLE });
    expect(viewGrantVersionPageUseCase).toHaveBeenCalledWith({
      code: "woodland",
      version: "1.2.0",
      tab: "phases",
      caller: "grants-platform-admin",
    });
  });

  it.each([
    [
      "not-stored",
      aPage({
        header: { files: { grant: { stored: false } } },
        lifecycle: null,
      }),
    ],
    ["unreadable", aPage({ lifecycle: null, problem: "phases[0] invalid" })],
    [
      "unavailable",
      aPage({
        lifecycle: null,
        sectionErrors: [{ section: "phases", message: "read failed" }],
      }),
    ],
  ])("answers %s", async (outcome, page) => {
    viewGrantVersionPageUseCase.mockResolvedValue(page);

    expect(await read()).toEqual({ outcome });
  });

  it("answers unavailable when the grant cannot be read", async () => {
    viewGrantVersionPageUseCase.mockRejectedValue(new Error("mongo down"));

    expect(await read()).toEqual({ outcome: "unavailable" });
  });
});
