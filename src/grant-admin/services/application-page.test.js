import { describe, expect, it, vi } from "vitest";
import { findApplicationSummary } from "../../grants/services/grant-admin.service.js";
import {
  APPLICATION_NOT_FOUND,
  readApplicationHeader,
} from "./application-page.js";

vi.mock("../../grants/services/grant-admin.service.js");

const SUMMARY = {
  clientRef: "ref-1",
  code: "woodland",
  position: { phase: "PRE_AWARD", stage: "REVIEW", status: "RECEIVED" },
  identifiers: { sbi: "123456789", frn: null, crn: null },
};

describe("readApplicationHeader", () => {
  it("answers the refs, position and an unknown case link, and the identifiers for the audit", async () => {
    findApplicationSummary.mockResolvedValue({
      summary: SUMMARY,
      storedBytes: 100,
    });

    const { header, accounts, sourceErrors } = await readApplicationHeader({
      clientRef: "ref-1",
      code: "woodland",
    });

    expect(findApplicationSummary).toHaveBeenCalledWith({
      clientRef: "ref-1",
      code: "woodland",
    });
    expect(header).toEqual({
      clientRef: "ref-1",
      code: "woodland",
      position: SUMMARY.position,
      counterpart: null,
      fetchedAt: expect.any(String),
    });
    expect(accounts).toEqual(SUMMARY.identifiers);
    expect(sourceErrors).toEqual([]);
  });

  it("answers 404 APPLICATION_NOT_FOUND, naming no ref, for an unknown application", async () => {
    findApplicationSummary.mockResolvedValue(null);

    const error = await readApplicationHeader({
      clientRef: "ref-1",
      code: "woodland",
    }).catch((e) => e);

    expect(error.output.statusCode).toBe(404);
    expect(error.output.payload).toMatchObject({
      message: "application not found",
      reason: APPLICATION_NOT_FOUND,
    });
  });
});
