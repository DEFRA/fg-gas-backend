import { Decimal128, Long } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findConfigVersionFiles,
  findConfigVersions,
  findGrantDefinitionSummary,
  findStoredGrantDefinition,
} from "../../grants/services/config-version.service.js";
import { findStoredPaymentDefinitionUseCase } from "../../payments/use-cases/find-stored-payment-definition.use-case.js";
import { SECTION_CAP_BYTES } from "../services/compose-record-page.js";
import {
  buildViewGrantVersionAudit,
  viewGrantVersionPageUseCase,
} from "./view-grant-version-page.use-case.js";

vi.mock("../../common/logger.js");
const audit = vi.hoisted(() => ({ builder: null }));
vi.mock("../../events/audited-read.js", () => ({
  auditedRead: (read, builder) => {
    audit.builder = builder;
    return read;
  },
}));
vi.mock("../../grants/services/config-version.service.js");
vi.mock("../../payments/use-cases/find-stored-payment-definition.use-case.js");

const REF = { code: "woodland", version: "2.0.0" };

const FILES = {
  ...REF,
  status: "draft",
  receivedAt: "2026-10-15T10:04:00.000Z",
  files: { grant: { stored: true, fetchStatus: "pending" } },
};

const VERSIONS = [
  { version: "2.0.0", status: "draft", receivedAt: "2026-10-15T10:04:00.000Z" },
  {
    version: "1.2.0",
    status: "active",
    receivedAt: "2026-10-10T16:25:00.000Z",
  },
];

const view = (tab) =>
  viewGrantVersionPageUseCase({ ...REF, tab, caller: "admin-ui" });

describe("viewGrantVersionPageUseCase", () => {
  beforeEach(() => {
    findConfigVersionFiles.mockResolvedValue(FILES);
    findConfigVersions.mockResolvedValue({
      code: "woodland",
      current: "1.2.0",
      versions: VERSIONS,
    });
    findGrantDefinitionSummary.mockResolvedValue({
      description: "Woodland creation",
      startDate: "2025-04-01",
      adminRole: null,
      storedBytes: 512,
    });
    findStoredGrantDefinition.mockResolvedValue({
      definition: { code: "woodland", version: "2.0.0" },
      storedBytes: 512,
    });
  });

  it("is audited as a read that releases data", () => {
    expect(audit.builder).toEqual(expect.any(Function));
  });

  it("draws the header from the version's files and every version of the grant", async () => {
    expect((await view("overview")).header).toEqual({
      ...FILES,
      versions: VERSIONS,
    });
    expect(findConfigVersionFiles).toHaveBeenCalledWith(REF);
    expect(findConfigVersions).toHaveBeenCalledWith("woodland");
  });

  it("overview: the stored grant's facts and size", async () => {
    const page = await view("overview");

    expect(page.overview).toEqual({
      description: "Woodland creation",
      startDate: "2025-04-01",
      adminRole: null,
      storedBytes: 512,
    });
    expect(page.sectionErrors).toEqual([]);
    expect(findStoredGrantDefinition).not.toHaveBeenCalled();
  });

  it("definition: the stored grant document, read under the section cap", async () => {
    const page = await view("definition");

    expect(page.definition).toEqual({ code: "woodland", version: "2.0.0" });
    expect(page.sectionErrors).toEqual([]);
    expect(findStoredGrantDefinition).toHaveBeenCalledWith(REF, {
      maxBytes: SECTION_CAP_BYTES,
    });
  });

  it("definition: BSON numbers go out as JSON", async () => {
    findStoredGrantDefinition.mockResolvedValue({
      definition: {
        code: "woodland",
        big: Long.fromString("9007199254740993"),
        rate: Decimal128.fromString("1.10"),
      },
      storedBytes: 512,
    });

    expect((await view("definition")).definition).toEqual({
      code: "woodland",
      big: "9007199254740993",
      rate: "1.10",
    });
  });

  it("definition: a grant file not stored is null, with no section error", async () => {
    findStoredGrantDefinition.mockResolvedValue({
      definition: null,
      storedBytes: null,
    });

    const page = await view("definition");

    expect(page.definition).toBeNull();
    expect(page.sectionErrors).toEqual([]);
  });

  it("definition: a stored document over the cap is too large to show", async () => {
    findStoredGrantDefinition.mockResolvedValue({
      definition: null,
      storedBytes: SECTION_CAP_BYTES + 1,
    });

    const page = await view("definition");

    expect(page.definition).toBeNull();
    expect(page.sectionErrors).toEqual([
      { section: "definition", message: "too large to show" },
    ]);
  });

  describe("payment", () => {
    const PAYMENT_FILES = {
      ...FILES,
      files: {
        ...FILES.files,
        payment: { stored: true, fetchStatus: "fetched" },
      },
    };

    beforeEach(() => {
      findConfigVersionFiles.mockResolvedValue(PAYMENT_FILES);
      findStoredPaymentDefinitionUseCase.mockResolvedValue({
        definition: { code: "woodland", currency: "GBP" },
        storedBytes: 512,
      });
    });

    it("the stored payment definition, read under the section cap", async () => {
      const page = await view("payment");

      expect(page.payment).toEqual({ code: "woodland", currency: "GBP" });
      expect(page.sectionErrors).toEqual([]);
      expect(findStoredPaymentDefinitionUseCase).toHaveBeenCalledWith(REF, {
        maxBytes: SECTION_CAP_BYTES,
      });
    });

    it("BSON numbers go out as JSON", async () => {
      findStoredPaymentDefinitionUseCase.mockResolvedValue({
        definition: { totalAmountPence: Long.fromString("9007199254740993") },
        storedBytes: 512,
      });

      expect((await view("payment")).payment).toEqual({
        totalAmountPence: "9007199254740993",
      });
    });

    it("a payment file not stored is null, with no section error", async () => {
      findStoredPaymentDefinitionUseCase.mockResolvedValue({
        definition: null,
        storedBytes: null,
      });

      const page = await view("payment");

      expect(page.payment).toBeNull();
      expect(page.sectionErrors).toEqual([]);
    });

    it("a stored definition over the cap is too large to show", async () => {
      findStoredPaymentDefinitionUseCase.mockResolvedValue({
        definition: null,
        storedBytes: SECTION_CAP_BYTES + 1,
      });

      const page = await view("payment");

      expect(page.payment).toBeNull();
      expect(page.sectionErrors).toEqual([
        { section: "payment", message: "too large to show" },
      ]);
    });

    it("answers 404 NO_DEFINITION_FILE for a version with no payment file", async () => {
      findConfigVersionFiles.mockResolvedValue(FILES);

      await expect(view("payment")).rejects.toMatchObject({
        output: {
          statusCode: 404,
          payload: { reason: "NO_DEFINITION_FILE" },
        },
      });
    });
  });

  it("answers 404 GRANT_VERSION_NOT_FOUND for an unknown version", async () => {
    findConfigVersionFiles.mockResolvedValue(null);

    await expect(view("overview")).rejects.toMatchObject({
      output: {
        statusCode: 404,
        payload: { reason: "GRANT_VERSION_NOT_FOUND" },
      },
    });
  });

  it("answers 404 GRANT_VERSION_NOT_FOUND when the grant has no versions", async () => {
    findConfigVersions.mockResolvedValue(null);

    await expect(view("definition")).rejects.toMatchObject({
      output: {
        statusCode: 404,
        payload: { reason: "GRANT_VERSION_NOT_FOUND" },
      },
    });
  });
});

describe("buildViewGrantVersionAudit", () => {
  const args = { ...REF, tab: "definition", caller: "admin-ui" };

  it("records the version and the tab against the grant, with PMC 0706", () => {
    expect(buildViewGrantVersionAudit(args)).toEqual({
      entities: [
        { entity: "GRANT", action: "VIEW_GRANT_VERSION", entityid: "woodland" },
      ],
      details: { caller: "admin-ui", version: "2.0.0", tab: "definition" },
      accounts: { sbi: undefined, frn: undefined, crn: undefined },
      security: { pmccode: "0706" },
      segregationRef: "admin-view-grant-version",
    });
  });

  it("records the payment tab", () => {
    expect(
      buildViewGrantVersionAudit({ ...args, tab: "payment" }).details,
    ).toEqual({ caller: "admin-ui", version: "2.0.0", tab: "payment" });
  });

  it("is the builder the view is audited with, for a refused view too", () => {
    expect(
      audit.builder(args, null, new Error("grant version not found")),
    ).toEqual(buildViewGrantVersionAudit(args));
  });
});
