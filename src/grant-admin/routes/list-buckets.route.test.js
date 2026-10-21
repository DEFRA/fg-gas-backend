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
import { listBucketsUseCase } from "../use-cases/list-buckets.use-case.js";
import { listBucketsRoute } from "./list-buckets.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/list-buckets.use-case.js");

const ENTRY = {
  id: "gas.outbox",
  path: "gas/outbox",
  label: "GAS outbox",
  service: "GAS",
  shortLabel: "Outbox",
  icon: "activity",
  order: 10,
  noun: { one: "event", many: "events" },
  time: { label: "Created" },
  facts: [
    {
      name: "status",
      param: "status",
      label: "Status",
      values: [{ value: "PUBLISHED", label: "Queued", tone: "neutral" }],
      toggle: null,
    },
    {
      name: "grantCode",
      param: "grantcode",
      label: "Grant",
      values: null,
      toggle: null,
    },
  ],
  refs: [{ kind: "ref", label: "Reference" }],
  indexes: [[], ["status"]],
  groupings: ["status"],
  title: { label: "Event", format: "eventType" },
  columns: [
    { key: "status", label: "Status", format: "badge", fact: "status" },
  ],
  audited: false,
  timeline: true,
  summaries: [],
  page: null,
  tab: null,
};

describe("listBucketsRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(listBucketsRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    listBucketsUseCase.mockResolvedValue({
      buckets: [ENTRY],
      sourceErrors: [],
    });
  });

  const get = (headers) =>
    server.inject({ method: "GET", url: "/grant-admin/buckets", headers });

  it("answers the catalogue with no header required", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual({ buckets: [ENTRY], sourceErrors: [] });
    expect(listBucketsUseCase).toHaveBeenCalledOnce();
  });

  it("answers the sources it could not read beside the entries it could", async () => {
    listBucketsUseCase.mockResolvedValue({
      buckets: [ENTRY],
      sourceErrors: [{ hop: "CW-BE" }],
    });

    expect((await get()).result.sourceErrors).toEqual([{ hop: "CW-BE" }]);
  });

  it("answers 500 rather than an entry that is not a catalogue entry", async () => {
    listBucketsUseCase.mockResolvedValue({
      buckets: [{ id: "gas.outbox" }],
      sourceErrors: [],
    });

    expect((await get()).statusCode).toBe(500);
  });
});
