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
import { fetchWorkflowDefinitionUseCase } from "../use-cases/fetch-workflow-definition.use-case.js";
import { fetchWorkflowDefinitionRoute } from "./fetch-workflow-definition.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/fetch-workflow-definition.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const FAILED = {
  files: [
    {
      file: "workflow",
      outcome: "failed",
      reason: "invalid",
      message: "Workflow phases are not unique",
    },
  ],
};

describe("fetchWorkflowDefinitionRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(fetchWorkflowDefinitionRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    fetchWorkflowDefinitionUseCase.mockResolvedValue(FAILED);
  });

  const post = (headers = HEADERS, code = "Casework-Smoke") =>
    server.inject({
      method: "POST",
      url: `/grant-admin/workflows/${code}/versions/1.2.0/fetch`,
      headers,
    });

  it("answers the workflow file's outcome, from one call naming the workflow, version, caller and operator", async () => {
    const response = await post();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(FAILED);
    expect(fetchWorkflowDefinitionUseCase).toHaveBeenCalledWith({
      code: "Casework-Smoke",
      version: "1.2.0",
      caller: "fg-grants-platform-admin",
      actor: "Jo Operator",
    });
  });

  it("names the operator to Caseworking decoded, as GPA encodes a name beyond Latin-1", async () => {
    await post({ ...HEADERS, "x-actor": "UTF-8''%C5%81ukasz%20Nowak" });

    expect(fetchWorkflowDefinitionUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "Łukasz Nowak" }),
    );
  });

  it("answers no files when the workflow was already stored", async () => {
    fetchWorkflowDefinitionUseCase.mockResolvedValue({ files: [] });

    expect((await post()).result).toEqual({ files: [] });
  });

  it.each([
    [504, Boom.gatewayTimeout("CW-BE workflows did not answer in time")],
    [502, Boom.badGateway("CW-BE workflows unavailable: HTTP 500")],
  ])(
    "answers %i when Caseworking did not answer the fetch",
    async (status, error) => {
      fetchWorkflowDefinitionUseCase.mockRejectedValue(error);

      expect((await post()).statusCode).toBe(status);
    },
  );

  it.each([
    ["no x-actor", { "x-actor-id": OID }],
    ["no x-actor-id", { "x-actor": "Jo" }],
  ])("refuses %s with 400", async (_name, headers) => {
    expect((await post(headers)).statusCode).toBe(400);
    expect(fetchWorkflowDefinitionUseCase).not.toHaveBeenCalled();
  });

  it("refuses a file of a grant's", async () => {
    fetchWorkflowDefinitionUseCase.mockResolvedValue({
      files: [{ file: "grant", outcome: "stored" }],
    });

    expect((await post()).statusCode).toBe(500);
  });
});
