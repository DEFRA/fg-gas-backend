import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
import { applicationExists } from "../../grants/services/application-read.service.js";
import { findCwCase } from "../repositories/cw-actuators.repository.js";
import { readCaseHeader, startCaseRead } from "./case-page.helpers.js";

vi.mock("../../common/logger.js");
vi.mock("../../grants/services/application-read.service.js");
vi.mock("../repositories/cw-actuators.repository.js");

const KEY = { workflowCode: "frps-private-beta", caseRef: "ref-1" };

const SUMMARY = {
  caseRef: "ref-1",
  workflowCode: "frps-private-beta",
  position: { phase: "PRE_AWARD", stage: "REVIEW", status: "RECEIVED" },
  closed: false,
  closedAt: null,
  createdAt: "2026-06-16T10:00:00.000Z",
};

const IDENTIFIERS = { sbi: "106284736", frn: null, crn: null };

const header = (caseRead) => readCaseHeader({ ...KEY, caseRead });

describe("startCaseRead", () => {
  it("reads the case once, with the options given", async () => {
    findCwCase.mockResolvedValue({ summary: SUMMARY });

    await startCaseRead(KEY, { actor: "Jo", include: "document" });

    expect(findCwCase).toHaveBeenCalledWith(KEY, {
      actor: "Jo",
      include: "document",
    });
  });
});

describe("readCaseHeader", () => {
  it("answers the refs, position, closure and application link, and the identifiers for the audit", async () => {
    applicationExists.mockResolvedValue({
      exists: true,
      identifiers: IDENTIFIERS,
    });

    const { header: drawn, accounts } = await header(
      Promise.resolve({ summary: SUMMARY, storedBytes: 10 }),
    );

    expect(applicationExists).toHaveBeenCalledWith({
      clientRef: "ref-1",
      code: "frps-private-beta",
    });
    expect(drawn).toEqual({
      caseRef: "ref-1",
      workflowCode: "frps-private-beta",
      position: SUMMARY.position,
      closed: false,
      closedAt: null,
      counterpart: { exists: true },
      fetchedAt: expect.any(String),
    });
    expect(accounts).toEqual(IDENTIFIERS);
  });

  it("draws an orphan case, with no accounts", async () => {
    applicationExists.mockResolvedValue({ exists: false, identifiers: null });

    const { header: drawn, accounts } = await header(
      Promise.resolve({ summary: SUMMARY }),
    );

    expect(drawn.counterpart).toEqual({ exists: false });
    expect(accounts).toBeNull();
  });

  it("leaves the application link unknown, with no source error, when GAS cannot read it", async () => {
    applicationExists.mockRejectedValue(new Error("mongo down"));

    const drawn = await header(Promise.resolve({ summary: SUMMARY }));

    expect(drawn.header.counterpart).toBeNull();
    expect(drawn.accounts).toBeUndefined();
    expect(drawn).not.toHaveProperty("sourceErrors");
  });

  it("fails with Caseworking's own failure", async () => {
    applicationExists.mockResolvedValue({ exists: true, identifiers: null });
    const notFound = Boom.notFound("case not found");

    await expect(header(Promise.reject(notFound))).rejects.toBe(notFound);
  });
});
