import Boom from "@hapi/boom";
import hapi from "@hapi/hapi";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { viewWorkflowVersionPageUseCase } from "../use-cases/view-workflow-version-page.use-case.js";
import { viewWorkflowVersionPhasesRoute } from "./view-workflow-version-phases.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/view-workflow-version-page.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const HEADER = {
  code: "woodland",
  version: "1.2.0",
  status: "active",
  receivedAt: "2026-10-01T09:00:00.000Z",
  files: { workflow: { stored: true, fetchStatus: "fetched" } },
  versions: [],
  counterpart: null,
};

const DEFINITION = {
  workflow: { code: "woodland", phases: [] },
  addresses: [],
};

const LIFECYCLE = {
  phases: [
    {
      code: "PRE_AWARD",
      name: "Pre award",
      stages: [
        {
          code: "APPLICATION",
          name: null,
          statuses: [
            { code: "RECEIVED", name: "Received" },
            { code: "AMEND", name: null },
          ],
        },
      ],
    },
  ],
  initialPosition: "PRE_AWARD:APPLICATION:RECEIVED",
  amendablePositions: ["PRE_AWARD:APPLICATION:AMEND"],
  waysIn: [
    {
      to: "PRE_AWARD:APPLICATION:RECEIVED",
      kind: "any",
      processes: [],
      processEffects: [],
    },
    {
      to: "PRE_AWARD:APPLICATION:AMEND",
      kind: "move",
      from: "PRE_AWARD:APPLICATION:RECEIVED",
      matchedBy: "status",
      processes: ["NOTIFY", "REQUEST_APPLICATION_WITHDRAWAL"],
      processEffects: [
        {
          process: "REQUEST_APPLICATION_WITHDRAWAL",
          setsStatus: "APPLICATION_WITHDRAWN",
          tellsCw: true,
          onlyWhen: "no agreement is on offer",
        },
      ],
    },
    {
      to: "PRE_AWARD:APPLICATION:AMEND",
      kind: "unmatched",
      code: "ON_HOLD",
      matchedBy: "status",
      processes: [],
      processEffects: [],
    },
  ],
  externalMappings: [
    {
      source: "CW",
      code: "PRE_AWARD:REVIEW:IN_REVIEW",
      whileIn: "PRE_AWARD:APPLICATION",
      mappedTo: "::AMEND",
      to: "PRE_AWARD:APPLICATION:AMEND",
    },
    {
      source: "AS",
      code: "offered",
      whileIn: "PRE_AWARD:APPLICATION",
      mappedTo: "S:X",
      to: null,
    },
  ],
  claimApproval: {
    from: "PRE_AWARD:APPLICATION:RECEIVED",
    to: "PRE_AWARD:APPLICATION:AMEND",
    tellsCw: true,
  },
};

const aPage = (overrides = {}) => ({
  header: HEADER,
  definition: DEFINITION,
  grantStatusMap: { outcome: "found", lifecycle: LIFECYCLE },
  sourceErrors: [],
  sectionErrors: [],
  ...overrides,
});

describe("viewWorkflowVersionPhasesRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(viewWorkflowVersionPhasesRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    viewWorkflowVersionPageUseCase.mockResolvedValue(aPage());
  });

  const get = (code = "woodland") =>
    server.inject({
      method: "GET",
      url: `/grant-admin/workflows/${code}/versions/1.2.0/phases`,
      headers: HEADERS,
    });

  it("answers the definition and the grant's lifecycle, never to be stored, for the phases tab as the operator", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.result).toEqual(aPage());
    expect(viewWorkflowVersionPageUseCase).toHaveBeenCalledWith({
      code: "woodland",
      version: "1.2.0",
      tab: "phases",
      caller: null,
      actor: "Jo Operator",
    });
  });

  it.each(["no-grant", "not-stored", "unreadable", "unavailable"])(
    "answers a grant status map that is %s",
    async (outcome) => {
      viewWorkflowVersionPageUseCase.mockResolvedValue(
        aPage({ grantStatusMap: { outcome } }),
      );

      expect((await get()).result.grantStatusMap).toEqual({ outcome });
    },
  );

  it("answers no grant status map beside a definition too large to show", async () => {
    const page = aPage({
      definition: null,
      grantStatusMap: null,
      sectionErrors: [{ section: "definition", message: "too large to show" }],
    });
    viewWorkflowVersionPageUseCase.mockResolvedValue(page);

    expect((await get()).result).toEqual(page);
  });

  it("answers an upper-case workflow code", async () => {
    expect((await get("FRPS")).statusCode).toBe(200);
  });

  it.each([
    ["an outcome it does not know", { outcome: "timed-out" }],
    ["a found map with no lifecycle", { outcome: "found" }],
  ])("refuses %s", async (_, grantStatusMap) => {
    viewWorkflowVersionPageUseCase.mockResolvedValue(aPage({ grantStatusMap }));

    expect((await get()).statusCode).toBe(500);
  });

  it("answers 404 as the definition tab does", async () => {
    const error = Boom.notFound("workflow version not found");
    error.output.payload.reason = "WORKFLOW_VERSION_NOT_FOUND";
    viewWorkflowVersionPageUseCase.mockRejectedValue(error);

    const response = await get();

    expect(response.statusCode).toBe(404);
    expect(response.result.reason).toBe("WORKFLOW_VERSION_NOT_FOUND");
  });
});
