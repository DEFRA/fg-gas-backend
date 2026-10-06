import { describe, expect, it, vi } from "vitest";
import {
  findCwPage,
  isCwConfigured,
} from "../repositories/cw-actuators.repository.js";
import { GAS } from "../services/event-sources.js";
import { readCaseworkingPage } from "./caseworking-page.helpers.js";

vi.mock("../../common/logger.js");
vi.mock("../repositories/cw-actuators.repository.js");

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
