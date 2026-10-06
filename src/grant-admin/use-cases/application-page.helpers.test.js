import { describe, expect, it, vi } from "vitest";
import Boom from "@hapi/boom";
import { findApplicationSummary } from "../../grants/services/application-read.service.js";
import { findCwCaseExistence } from "../repositories/cw-actuators.repository.js";
import { APPLICATION_NOT_FOUND } from "../services/application-not-found.js";
import { readApplicationHeader } from "./application-page.helpers.js";

vi.mock("../../common/logger.js");
vi.mock("../../grants/services/application-read.service.js");
vi.mock("../repositories/cw-actuators.repository.js");

const SUMMARY = {
  clientRef: "ref-1",
  code: "woodland",
  position: { phase: "PRE_AWARD", stage: "REVIEW", status: "RECEIVED" },
  identifiers: { sbi: "123456789", frn: null, crn: null },
};

describe("readApplicationHeader", () => {
  it("answers the refs, position and case link, and the identifiers for the audit", async () => {
    findApplicationSummary.mockResolvedValue({
      summary: SUMMARY,
      storedBytes: 100,
    });
    findCwCaseExistence.mockResolvedValue({ exists: true });

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
      counterpart: { exists: true },
      fetchedAt: expect.any(String),
    });
    expect(findCwCaseExistence).toHaveBeenCalledWith({
      workflowCode: "woodland",
      caseRef: "ref-1",
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

  it("says the case does not exist when Caseworking says so", async () => {
    findApplicationSummary.mockResolvedValue({ summary: SUMMARY });
    findCwCaseExistence.mockResolvedValue({ exists: false });

    const { header, sourceErrors } = await readApplicationHeader({
      clientRef: "ref-1",
      code: "woodland",
    });

    expect(header.counterpart).toEqual({ exists: false });
    expect(sourceErrors).toEqual([]);
  });

  it("leaves the case link unknown, naming Caseworking's cases, when it cannot answer", async () => {
    findApplicationSummary.mockResolvedValue({ summary: SUMMARY });
    findCwCaseExistence.mockRejectedValue(
      Boom.gatewayTimeout("CW-BE cases did not answer in time"),
    );

    const { header, sourceErrors } = await readApplicationHeader({
      clientRef: "ref-1",
      code: "woodland",
    });

    expect(header.counterpart).toBeNull();
    expect(sourceErrors).toEqual([
      { key: "cwCases", service: "caseworking", label: "CW-BE Cases" },
    ]);
  });
});
