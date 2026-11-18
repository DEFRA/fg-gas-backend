import { describe, expect, it, vi } from "vitest";
import Boom from "@hapi/boom";
import { findApplicationSummary } from "../../grants/services/application-read.service.js";
import { findGrantPhaseNames } from "../../grants/services/config-version.service.js";
import { findCwCaseExistence } from "../repositories/cw-actuators.repository.js";
import { APPLICATION_NOT_FOUND } from "../services/application-not-found.js";
import { readApplicationHeader } from "./application-page.helpers.js";

vi.mock("../../common/logger.js");
vi.mock("../../grants/services/application-read.service.js");
vi.mock("../../grants/services/config-version.service.js");
vi.mock("../repositories/cw-actuators.repository.js");

const SUMMARY = {
  clientRef: "ref-1",
  code: "woodland",
  position: { phase: "PRE_AWARD", stage: "REVIEW", status: "RECEIVED" },
  currentConfigVersion: "1.2.0",
  identifiers: { sbi: "123456789", frn: null, crn: null },
};

const PHASES = [
  {
    code: "PRE_AWARD",
    name: "Pre award",
    stages: [
      {
        code: "REVIEW",
        name: "Review",
        statuses: [{ code: "RECEIVED", name: "Received" }],
      },
    ],
  },
];

const readHeader = () =>
  readApplicationHeader({ clientRef: "ref-1", code: "woodland" });

describe("readApplicationHeader names", () => {
  it("names where the application is from its grant version's definition", async () => {
    findApplicationSummary.mockResolvedValue({ summary: SUMMARY });
    findGrantPhaseNames.mockResolvedValue(PHASES);

    const { header } = await readHeader();

    expect(findGrantPhaseNames).toHaveBeenCalledWith({
      code: "woodland",
      version: "1.2.0",
    });
    expect(header.names).toEqual({
      phases: [{ code: "PRE_AWARD", name: "Pre award" }],
      stage: "Review",
      status: "Received",
    });
  });

  it("names nothing, and reads no definition, for an application on no version", async () => {
    findApplicationSummary.mockResolvedValue({
      summary: { ...SUMMARY, currentConfigVersion: null },
    });

    expect((await readHeader()).header.names).toBeNull();
    expect(findGrantPhaseNames).not.toHaveBeenCalled();
  });

  it("names nothing when the version's definition is not stored or is refused", async () => {
    findApplicationSummary.mockResolvedValue({ summary: SUMMARY });
    findGrantPhaseNames.mockResolvedValue(null);

    expect((await readHeader()).header.names).toBeNull();
  });

  it("names nothing, and still answers the header, when the definition cannot be read", async () => {
    findApplicationSummary.mockResolvedValue({ summary: SUMMARY });
    findGrantPhaseNames.mockRejectedValue(new Error("mongo down"));

    const { header } = await readHeader();

    expect(header.names).toBeNull();
    expect(header.position).toEqual(SUMMARY.position);
  });
});

describe("readApplicationHeader", () => {
  it("answers the refs, position and case link, and the identifiers for the audit", async () => {
    findApplicationSummary.mockResolvedValue({
      summary: SUMMARY,
      storedBytes: 100,
    });
    findCwCaseExistence.mockResolvedValue({ exists: true });

    const { header, accounts } = await readApplicationHeader({
      clientRef: "ref-1",
      code: "woodland",
      withCounterpart: true,
    });

    expect(findApplicationSummary).toHaveBeenCalledWith({
      clientRef: "ref-1",
      code: "woodland",
    });
    expect(header).toEqual({
      clientRef: "ref-1",
      code: "woodland",
      position: SUMMARY.position,
      version: "1.2.0",
      names: null,
      counterpart: { exists: true },
      fetchedAt: expect.any(String),
    });
    expect(findCwCaseExistence).toHaveBeenCalledWith({
      workflowCode: "woodland",
      caseRef: "ref-1",
    });
    expect(accounts).toEqual(SUMMARY.identifiers);
  });

  it("leaves the case link out, without asking Caseworking, when the tab does not show it", async () => {
    findApplicationSummary.mockResolvedValue({ summary: SUMMARY });

    const { header } = await readApplicationHeader({
      clientRef: "ref-1",
      code: "woodland",
    });

    expect(header.counterpart).toBeNull();
    expect(findCwCaseExistence).not.toHaveBeenCalled();
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

    const { header } = await readApplicationHeader({
      clientRef: "ref-1",
      code: "woodland",
      withCounterpart: true,
    });

    expect(header.counterpart).toEqual({ exists: false });
  });

  it("leaves the case link unknown, and the page without a source error, when Caseworking cannot answer", async () => {
    findApplicationSummary.mockResolvedValue({ summary: SUMMARY });
    findCwCaseExistence.mockRejectedValue(
      Boom.gatewayTimeout("CW-BE cases did not answer in time"),
    );

    const drawn = await readApplicationHeader({
      clientRef: "ref-1",
      code: "woodland",
      withCounterpart: true,
    });

    expect(drawn.header.counterpart).toBeNull();
    expect(drawn).not.toHaveProperty("sourceErrors");
  });
});
