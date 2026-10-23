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
import { viewWorkflowVersionOverviewRoute } from "./view-workflow-version-overview.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/view-workflow-version-page.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const HEADER = {
  code: "Casework-Smoke",
  version: "2.0.0",
  status: "draft",
  receivedAt: "2026-10-15T10:04:00.000Z",
  files: { workflow: { stored: false, fetchStatus: "permanent_error" } },
  versions: [
    {
      version: "2.0.0",
      status: "draft",
      receivedAt: "2026-10-15T10:04:00.000Z",
    },
  ],
  counterpart: { exists: false },
};

const PAGE = {
  header: HEADER,
  overview: { schemeName: null, requiredRoles: null, storedBytes: null },
  sourceErrors: [],
  sectionErrors: [],
};

const versionNotFound = () => {
  const error = Boom.notFound("workflow version not found");

  error.output.payload.reason = "WORKFLOW_VERSION_NOT_FOUND";

  return error;
};

describe("viewWorkflowVersionOverviewRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(viewWorkflowVersionOverviewRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    viewWorkflowVersionPageUseCase.mockResolvedValue(PAGE);
  });

  const get = (headers = HEADERS, version = "2.0.0", code = "Casework-Smoke") =>
    server.inject({
      method: "GET",
      url: `/grant-admin/workflows/${code}/versions/${version}/overview`,
      headers,
    });

  it("answers an upper-case workflow not stored, never to be stored, in one use-case call as the operator", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(PAGE);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(viewWorkflowVersionPageUseCase).toHaveBeenCalledWith({
      code: "Casework-Smoke",
      version: "2.0.0",
      tab: "overview",
      caller: "fg-grants-platform-admin",
      actor: "Jo Operator",
    });
  });

  it("answers 404 with its reason for an unknown version", async () => {
    viewWorkflowVersionPageUseCase.mockRejectedValue(versionNotFound());

    const response = await get();

    expect(response.statusCode).toBe(404);
    expect(response.result.reason).toBe("WORKFLOW_VERSION_NOT_FOUND");
  });

  it.each([
    ["no x-actor", { "x-actor-id": OID }],
    ["no x-actor-id", { "x-actor": "Jo" }],
  ])("refuses %s with 400", async (_name, headers) => {
    expect((await get(headers)).statusCode).toBe(400);
    expect(viewWorkflowVersionPageUseCase).not.toHaveBeenCalled();
  });

  it.each([
    ["a version that is not semver", "2.0", "woodland"],
    ["a code outside the workflow alphabet", "2.0.0", "wood_land"],
  ])("refuses %s with 400", async (_name, version, code) => {
    expect((await get(HEADERS, version, code)).statusCode).toBe(400);
    expect(viewWorkflowVersionPageUseCase).not.toHaveBeenCalled();
  });

  it.each([
    ["a status other than active or draft", { status: "retired" }],
    [
      "a file of a grant's",
      {
        files: {
          ...HEADER.files,
          grant: { stored: false, fetchStatus: "pending" },
        },
      },
    ],
  ])("refuses a header with %s", async (_name, change) => {
    viewWorkflowVersionPageUseCase.mockResolvedValue({
      ...PAGE,
      header: { ...HEADER, ...change },
    });

    expect((await get()).statusCode).toBe(500);
  });
});
