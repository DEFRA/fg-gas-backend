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
import { viewWorkflowVersionRawRoute } from "./view-workflow-version-raw.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/view-workflow-version-page.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const PAGE = {
  header: {
    code: "woodland",
    version: "1.2.0",
    status: "active",
    receivedAt: "2026-10-01T09:00:00.000Z",
    files: { workflow: { stored: true, fetchStatus: "fetched" } },
    versions: [],
    counterpart: null,
  },
  raw: { _id: "6710c4", code: "woodland", anything: { at: "all" } },
  storedBytes: 48213,
  sourceErrors: [],
  sectionErrors: [],
};

describe("viewWorkflowVersionRawRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(viewWorkflowVersionRawRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    viewWorkflowVersionPageUseCase.mockResolvedValue(PAGE);
  });

  const get = () =>
    server.inject({
      method: "GET",
      url: "/grant-admin/workflows/woodland/versions/1.2.0/raw",
      headers: HEADERS,
    });

  it("answers the stored workflow whole, with its size, for the raw tab", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(PAGE);
    expect(viewWorkflowVersionPageUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ tab: "raw" }),
    );
  });

  it("never carries the addresses beside the document", async () => {
    viewWorkflowVersionPageUseCase.mockResolvedValue({
      ...PAGE,
      addresses: [],
    });

    expect((await get()).statusCode).toBe(500);
  });
});
