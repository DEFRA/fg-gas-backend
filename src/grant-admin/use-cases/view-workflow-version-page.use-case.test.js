import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { grantVersionExists } from "../../grants/services/config-version.service.js";
import { findCwWorkflowVersion } from "../repositories/cw-workflows.repository.js";
import { SECTION_CAP_BYTES } from "../services/compose-record-page.js";
import { readWorkflowVersionEventsUseCase } from "./read-record-events.use-case.js";
import {
  buildViewWorkflowVersionAudit,
  viewWorkflowVersionPageUseCase,
} from "./view-workflow-version-page.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("../../events/audited-read.js", () => ({
  auditedRead: (read) => read,
}));
vi.mock("../../grants/services/config-version.service.js");
vi.mock("../repositories/cw-workflows.repository.js");
vi.mock("./read-record-events.use-case.js");

const REF = { code: "woodland", version: "1.2.0" };

const SUMMARY = {
  schemeName: "Woodland Creation",
  requiredRoles: { allOf: ["Casework.Read"], anyOf: ["Casework.Admin"] },
};

const DOCUMENT = { _id: "6710c4", code: "woodland", phases: [] };

const ADDRESSES = [
  {
    code: "land-parcels",
    service: "LAND_DATA",
    url: "https://land.test/parcels/{sbi}",
  },
];

const aRead = (overrides = {}) => ({
  version: {
    grantCode: "woodland",
    version: "1.2.0",
    status: "active",
    receivedAt: "2026-10-01T09:00:00.000Z",
    fetchStatus: "fetched",
  },
  versions: [],
  current: "1.2.0",
  storedBytes: 48213,
  summary: SUMMARY,
  document: null,
  addresses: null,
  ...overrides,
});

const NOT_STORED = aRead({ storedBytes: null, summary: null });

const view = (tab) =>
  viewWorkflowVersionPageUseCase({
    ...REF,
    tab,
    caller: "admin-ui",
    actor: "Jo",
  });

describe("viewWorkflowVersionPageUseCase", () => {
  beforeEach(() => {
    findCwWorkflowVersion.mockImplementation(async (_ref, { include }) =>
      aRead(include ? { document: DOCUMENT, addresses: ADDRESSES } : {}),
    );
    grantVersionExists.mockResolvedValue(true);
  });

  it.each([
    ["overview", undefined],
    ["definition", "document"],
    ["raw", "document"],
    ["events", undefined],
  ])("reads Caseworking once for the %s tab", async (tab, include) => {
    await view(tab);

    expect(findCwWorkflowVersion).toHaveBeenCalledTimes(1);
    expect(findCwWorkflowVersion).toHaveBeenCalledWith(REF, {
      actor: "Jo",
      include,
    });
  });

  it("reads the grant link on the overview alone", async () => {
    expect((await view("overview")).header.counterpart).toEqual({
      exists: true,
    });
    expect((await view("raw")).header.counterpart).toBeNull();
    expect(grantVersionExists).toHaveBeenCalledTimes(1);
  });

  it("overview: the scheme name, the roles and the stored size", async () => {
    expect((await view("overview")).overview).toEqual({
      schemeName: "Woodland Creation",
      requiredRoles: SUMMARY.requiredRoles,
      storedBytes: 48213,
    });
  });

  it("overview: every fact null while the workflow is not stored", async () => {
    findCwWorkflowVersion.mockResolvedValue(NOT_STORED);

    expect((await view("overview")).overview).toEqual({
      schemeName: null,
      requiredRoles: null,
      storedBytes: null,
    });
  });

  it("definition: the stored workflow with each endpoint's address", async () => {
    expect((await view("definition")).definition).toEqual({
      workflow: DOCUMENT,
      addresses: ADDRESSES,
    });
  });

  it("events: Caseworking's config version events of this version, as the operator", async () => {
    readWorkflowVersionEventsUseCase.mockResolvedValue({
      content: { events: { rows: [], more: false } },
      sourceErrors: [{ hop: "CW-BE" }],
    });

    const page = await view("events");

    expect(page.events).toEqual({ rows: [], more: false });
    expect(page.sourceErrors).toEqual([{ hop: "CW-BE" }]);
    expect(readWorkflowVersionEventsUseCase).toHaveBeenCalledExactlyOnceWith({
      code: "woodland",
      version: "1.2.0",
      actor: "Jo",
    });
  });

  it("raw: the stored workflow with its size, the size logged", async () => {
    const page = await view("raw");

    expect(page.raw).toEqual(DOCUMENT);
    expect(page.storedBytes).toBe(48213);
    expect(logger.info).toHaveBeenCalledWith(
      "Read workflow document: 48213 bytes",
    );
  });

  it.each(["definition", "raw"])(
    "%s: null with no section error while the workflow is not stored",
    async (tab) => {
      findCwWorkflowVersion.mockResolvedValue(NOT_STORED);

      const page = await view(tab);

      expect(page[tab]).toBeNull();
      expect(page.header.files.workflow.stored).toBe(false);
      expect(page.sectionErrors).toEqual([]);
    },
  );

  it.each(["definition", "raw"])(
    "%s: a document over Caseworking's read limit is too large to show, the header still drawn",
    async (tab) => {
      findCwWorkflowVersion.mockResolvedValue(
        aRead({ storedBytes: 5_000_000, tooLarge: true }),
      );

      const page = await view(tab);

      expect(page.header.code).toBe("woodland");
      expect(page[tab]).toBeNull();
      expect(page.sectionErrors).toEqual([
        { section: tab, message: "too large to show" },
      ]);
    },
  );

  it.each(["definition", "raw"])(
    "%s: a document over the section cap is too large to show",
    async (tab) => {
      findCwWorkflowVersion.mockResolvedValue(
        aRead({
          document: { big: "x".repeat(SECTION_CAP_BYTES) },
          addresses: [],
        }),
      );

      const page = await view(tab);

      expect(page[tab]).toBeNull();
      expect(page.sectionErrors).toEqual([
        { section: tab, message: "too large to show" },
      ]);
    },
  );

  it.each([
    [404, Boom.notFound("workflow version not found")],
    [504, Boom.gatewayTimeout("CW-BE workflows did not answer in time")],
    [502, Boom.badGateway("CW-BE workflows unavailable: HTTP 500")],
  ])("answers %i with Caseworking's failure", async (status, error) => {
    findCwWorkflowVersion.mockRejectedValue(error);

    const failure = await view("overview").catch((e) => e);

    expect(failure.output.statusCode).toBe(status);
  });
});

describe("buildViewWorkflowVersionAudit", () => {
  it("records the workflow, the version, the tab and PMC 0706", () => {
    expect(
      buildViewWorkflowVersionAudit({
        ...REF,
        tab: "raw",
        caller: "admin-ui",
        actor: "Jo",
      }),
    ).toEqual({
      entities: [
        {
          entity: "WORKFLOW",
          action: "VIEW_WORKFLOW_VERSION",
          entityid: "woodland",
        },
      ],
      details: { caller: "admin-ui", version: "1.2.0", tab: "raw" },
      accounts: { sbi: undefined, frn: undefined, crn: undefined },
      security: { pmccode: "0706" },
      segregationRef: "admin-view-workflow-version",
    });
  });
});
