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
import { viewWorkflowVersionDefinitionRoute } from "./view-workflow-version-definition.route.js";

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
  addresses: [
    {
      code: "land-parcels",
      service: "LAND_DATA",
      url: "https://land.test/parcels/{sbi}",
    },
    { code: "unset", service: "NOWHERE", url: null },
  ],
};

const aPage = (definition) => ({
  header: HEADER,
  definition,
  sourceErrors: [],
  sectionErrors: [],
});

describe("viewWorkflowVersionDefinitionRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(viewWorkflowVersionDefinitionRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    viewWorkflowVersionPageUseCase.mockResolvedValue(aPage(DEFINITION));
  });

  const get = () =>
    server.inject({
      method: "GET",
      url: "/grant-admin/workflows/woodland/versions/1.2.0/definition",
      headers: HEADERS,
    });

  it("answers the stored workflow with each endpoint's address, for the definition tab", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(aPage(DEFINITION));
    expect(viewWorkflowVersionPageUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ tab: "definition" }),
    );
  });

  it("answers a workflow not stored as null", async () => {
    viewWorkflowVersionPageUseCase.mockResolvedValue(aPage(null));

    expect((await get()).result.definition).toBeNull();
  });

  it("refuses an address carrying anything but its code, service and url", async () => {
    viewWorkflowVersionPageUseCase.mockResolvedValue(
      aPage({
        ...DEFINITION,
        addresses: [{ ...DEFINITION.addresses[0], headers: "secret" }],
      }),
    );

    expect((await get()).statusCode).toBe(500);
  });
});
