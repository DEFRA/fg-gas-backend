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
import { listWorkflowVersionsUseCase } from "../use-cases/list-workflow-versions.use-case.js";
import { viewWorkflowVersionsRoute } from "./view-workflow-versions.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/list-workflow-versions.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const VERSIONS = {
  code: "Casework-Smoke",
  current: "1.0.0",
  versions: [
    {
      version: "1.0.0",
      status: "active",
      receivedAt: "2026-10-15T10:04:00.000Z",
    },
  ],
};

describe("viewWorkflowVersionsRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(viewWorkflowVersionsRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    listWorkflowVersionsUseCase.mockResolvedValue(VERSIONS);
  });

  const get = (headers = HEADERS, code = "Casework-Smoke") =>
    server.inject({
      method: "GET",
      url: `/grant-admin/workflows/${code}/versions`,
      headers,
    });

  it("answers the workflow's versions, never to be stored, asked as the operator", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(VERSIONS);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(listWorkflowVersionsUseCase).toHaveBeenCalledWith({
      code: "Casework-Smoke",
      actor: "Jo Operator",
    });
  });

  it("answers 404 with Caseworking's reason for a workflow with no versions", async () => {
    const notFound = Boom.notFound("workflow not found");
    notFound.output.payload.reason = "WORKFLOW_NOT_FOUND";
    listWorkflowVersionsUseCase.mockRejectedValue(notFound);

    const response = await get();

    expect(response.statusCode).toBe(404);
    expect(response.result.reason).toBe("WORKFLOW_NOT_FOUND");
  });

  it("refuses an operator with no Entra id", async () => {
    expect((await get({ "x-actor": "Jo" })).statusCode).toBe(400);
    expect(listWorkflowVersionsUseCase).not.toHaveBeenCalled();
  });
});
