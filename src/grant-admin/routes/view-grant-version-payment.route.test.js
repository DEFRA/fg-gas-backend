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
import {
  grantVersionNotFound,
  noDefinitionFile,
} from "../services/grant-not-found.js";
import { viewGrantVersionPageUseCase } from "../use-cases/view-grant-version-page.use-case.js";
import { viewGrantVersionPaymentRoute } from "./view-grant-version-payment.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/view-grant-version-page.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const HEADER = {
  code: "woodland",
  version: "2.0.0",
  status: "draft",
  receivedAt: "2026-10-15T10:04:00.000Z",
  s3Bucket: "config-broker-local",
  files: {
    grant: { stored: false, fetchStatus: "pending" },
    payment: { stored: true, fetchStatus: "fetched" },
  },
  versions: [
    {
      version: "2.0.0",
      status: "draft",
      receivedAt: "2026-10-15T10:04:00.000Z",
    },
  ],
  counterpart: null,
};

const PAGE = {
  header: HEADER,
  payment: {
    code: "woodland",
    sbi: "$.agreement.identifiers.sbi",
    payments: [{ dueDate: "@.dueDate", invoiceLines: [] }],
  },
  sourceErrors: [],
  sectionErrors: [],
};

describe("viewGrantVersionPaymentRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(viewGrantVersionPaymentRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    viewGrantVersionPageUseCase.mockResolvedValue(PAGE);
  });

  const get = (headers = HEADERS, version = "2.0.0", code = "woodland") =>
    server.inject({
      method: "GET",
      url: `/grant-admin/grants/${code}/versions/${version}/payment`,
      headers,
    });

  it("answers the stored payment definition, never to be stored, in one use-case call", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(PAGE);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(viewGrantVersionPageUseCase).toHaveBeenCalledWith({
      code: "woodland",
      version: "2.0.0",
      tab: "payment",
      caller: "fg-grants-platform-admin",
    });
  });

  it.each([
    ["an unknown version", grantVersionNotFound, "GRANT_VERSION_NOT_FOUND"],
    ["a version with no payment file", noDefinitionFile, "NO_DEFINITION_FILE"],
  ])("answers 404 with its reason for %s", async (_name, error, reason) => {
    viewGrantVersionPageUseCase.mockRejectedValue(error());

    const response = await get();

    expect(response.statusCode).toBe(404);
    expect(response.result.reason).toBe(reason);
  });

  it("answers a payment file not stored as null", async () => {
    const notStored = {
      ...PAGE,
      header: {
        ...HEADER,
        files: {
          ...HEADER.files,
          payment: { stored: false, fetchStatus: "pending" },
        },
      },
      payment: null,
    };
    viewGrantVersionPageUseCase.mockResolvedValue(notStored);

    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(notStored);
  });

  it.each([
    ["no x-actor", { "x-actor-id": OID }],
    ["no x-actor-id", { "x-actor": "Jo" }],
  ])("refuses %s with 400", async (_name, headers) => {
    expect((await get(headers)).statusCode).toBe(400);
    expect(viewGrantVersionPageUseCase).not.toHaveBeenCalled();
  });

  it.each([
    ["a version that is not semver", "2.0", "woodland"],
    ["a code outside the code alphabet", "2.0.0", "Woodland"],
  ])("refuses %s with 400", async (_name, version, code) => {
    expect((await get(HEADERS, version, code)).statusCode).toBe(400);
    expect(viewGrantVersionPageUseCase).not.toHaveBeenCalled();
  });

  it("answers a too-large payment definition as null beside its section error", async () => {
    const tooLarge = {
      ...PAGE,
      payment: null,
      sectionErrors: [{ section: "payment", message: "too large to show" }],
    };
    viewGrantVersionPageUseCase.mockResolvedValue(tooLarge);

    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(tooLarge);
  });
});
