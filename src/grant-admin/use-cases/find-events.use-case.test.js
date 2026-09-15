import Boom from "@hapi/boom";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { findPage as findGasInboxPage } from "../../grants/repositories/inbox.repository.js";
import { findPage as findGasOutboxPage } from "../../grants/repositories/outbox.repository.js";
import { isCwConfigured } from "../repositories/cw-actuators.repository.js";
import {
  encodeCompositeCursor,
  encodeSourceCursor,
} from "../services/event-cursor.js";

const { INBOX_MAX_RETRIES, OUTBOX_MAX_RETRIES } = vi.hoisted(() => ({
  INBOX_MAX_RETRIES: 5,
  OUTBOX_MAX_RETRIES: 4,
}));

vi.mock("../../common/logger.js");
vi.mock("../../grants/repositories/inbox.repository.js", () => ({
  findPage: vi.fn(),
}));
vi.mock("../../grants/repositories/outbox.repository.js", () => ({
  findPage: vi.fn(),
}));
vi.mock("../../common/config.js", () => ({
  config: {
    inbox: { inboxMaxRetries: INBOX_MAX_RETRIES },
    outbox: { outboxMaxRetries: OUTBOX_MAX_RETRIES },
    cwBackend: { url: "http://cw.test", token: "cw-token" },
    httpClient: { timeoutMs: 3000 },
    tracingHeader: "x-cdp-request-id",
  },
}));
vi.mock(
  "../repositories/cw-actuators.repository.js",
  async (importOriginal) => ({
    ...(await importOriginal()),
    isCwConfigured: vi.fn(),
  }),
);

const { findEventsUseCase } = await import("./find-events.use-case.js");

const hexId = (n) => `665f1c2e9a1b2c3d4e5f${String(n).padStart(4, "0")}`;

const at = (minute) =>
  `2026-06-16T10:${String(minute).padStart(2, "0")}:00.000Z`;

const gasInboxDoc = (n, overrides = {}) => ({
  _id: ObjectId.createFromHexString(hexId(n)),
  messageId: `msg-${n}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  status: "PUBLISHED",
  completionAttempts: 1,
  publicationDate: at(n),
  lastResubmissionDate: null,
  completionDate: null,
  segregationRef: `ref-${n}`,
  ...overrides,
});

const gasOutboxDoc = (n, overrides = {}) => ({
  _id: ObjectId.createFromHexString(hexId(n)),
  target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case",
  event: {
    id: `evt-${n}`,
    type: "cloud.defra.local.fg-gas-backend.case.create",
  },
  status: "PUBLISHED",
  completionAttempts: 1,
  publicationDate: new Date(at(n)),
  lastResubmissionDate: null,
  completionDate: null,
  segregationRef: `ref-${n}`,
  ...overrides,
});

const cwRow = (n, overrides = {}) => ({
  _id: hexId(n),
  eventId: `cw-evt-${n}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  status: "PUBLISHED",
  publicationDate: at(n),
  completedAt: null,
  ...overrides,
});

const emptyPagination = {
  endCursor: null,
  hasNextPage: false,
};

const pageOf = (data) => ({ data, pagination: { ...emptyPagination } });

const emptyPage = () => pageOf([]);

const ZERO_COUNTS = {
  PUBLISHED: 0,
  PROCESSING: 0,
  FAILED: 0,
  RESUBMITTED: 0,
  COMPLETED: 0,
  DEAD_LETTER: 0,
};

const cwBox = (list) => ({
  list,
  facets: { counts: { ...ZERO_COUNTS } },
  groups: [],
});

const cwPage = ({ inbox = emptyPage(), outbox = emptyPage() } = {}) => ({
  inbox: cwBox(inbox),
  outbox: cwBox(outbox),
});

const cwInboxRows = (rows) => cwPage({ inbox: pageOf(rows) });

// The events page reads Caseworking once and hands every section the same promise.
const find = (options = {}, caseworking = Promise.resolve(cwPage())) =>
  findEventsUseCase({ caseworking, ...options });

const cwDown = (error) => {
  const rejected = Promise.reject(error);

  rejected.catch(() => {});

  return rejected;
};

beforeEach(() => {
  isCwConfigured.mockReturnValue(true);
  findGasInboxPage.mockResolvedValue(emptyPage());
  findGasOutboxPage.mockResolvedValue(emptyPage());
});

describe("findEventsUseCase", () => {
  it("with no filters reads both GAS boxes with a null cursor at pageSize 20", async () => {
    await find();

    for (const fetchPage of [findGasInboxPage, findGasOutboxPage]) {
      expect(fetchPage).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: null,
          status: undefined,
          pageSize: 20,
        }),
      );
    }
  });

  it("merges rows from four sources newest first and returns 20", async () => {
    findGasInboxPage.mockResolvedValue(
      pageOf(Array.from({ length: 8 }, (_, i) => gasInboxDoc(i + 1))),
    );
    findGasOutboxPage.mockResolvedValue(
      pageOf(Array.from({ length: 8 }, (_, i) => gasOutboxDoc(i + 11))),
    );
    const result = await find(
      {},
      Promise.resolve(
        cwPage({
          inbox: pageOf(Array.from({ length: 8 }, (_, i) => cwRow(i + 21))),
          outbox: pageOf(Array.from({ length: 8 }, (_, i) => cwRow(i + 31))),
        }),
      ),
    );

    expect(result.events).toHaveLength(20);
    const times = result.events.map((event) => event.createdAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(result.pagination.hasNextPage).toBe(true);
  });

  it("passes each GAS source its own slice of a composite cursor", async () => {
    const slices = {
      gasInbox: encodeSourceCursor({
        cursorValue: at(5),
        id: hexId(5),
      }),
      gasOutbox: encodeSourceCursor({
        cursorValue: at(6),
        id: hexId(6),
      }),
      cwInbox: encodeSourceCursor({
        cursorValue: at(7),
        id: hexId(7),
      }),
      cwOutbox: null,
    };

    await find({ cursor: encodeCompositeCursor(slices) });

    expect(findGasInboxPage.mock.calls[0][0].cursor).toEqual(slices.gasInbox);
    expect(findGasOutboxPage.mock.calls[0][0].cursor).toEqual(slices.gasOutbox);
  });

  it("passes status to both GAS sources", async () => {
    await find({ status: "DEAD_LETTER" });

    for (const fetchPage of [findGasInboxPage, findGasOutboxPage]) {
      expect(fetchPage.mock.calls[0][0].status).toEqual("DEAD_LETTER");
    }
  });

  it("with service=gas queries only the two GAS sources and reports no sourceErrors", async () => {
    const result = await find(
      { service: "gas" },
      Promise.resolve(cwInboxRows([cwRow(1)])),
    );

    expect(findGasInboxPage).toHaveBeenCalled();
    expect(findGasOutboxPage).toHaveBeenCalled();
    expect(result.events).toHaveLength(0);
    expect(result.sourceErrors).toEqual([]);
  });

  it("with service=caseworking lists only the two CW sources", async () => {
    const result = await find(
      { service: "caseworking" },
      Promise.resolve(cwInboxRows([cwRow(1)])),
    );

    expect(findGasInboxPage).not.toHaveBeenCalled();
    expect(findGasOutboxPage).not.toHaveBeenCalled();
    expect(result.events.map((event) => event.service)).toEqual([
      "caseworking",
    ]);
  });

  it("lists the rows of the Caseworking page the caller shared", async () => {
    const result = await find({}, Promise.resolve(cwInboxRows([cwRow(1)])));

    expect(result.events).toHaveLength(1);
  });

  it("reports both caseworking boxes and still returns GAS rows when the CW read rejects", async () => {
    findGasInboxPage.mockResolvedValue(pageOf([gasInboxDoc(1)]));

    const result = await find({}, cwDown(Boom.gatewayTimeout("timeout")));

    expect(result.events).toHaveLength(1);
    expect(result.sourceErrors).toEqual([
      { key: "cwInbox", service: "caseworking", box: "inbox" },
      { key: "cwOutbox", service: "caseworking", box: "outbox" },
    ]);
  });

  it("reports only the box whose rows Caseworking could not read", async () => {
    const result = await find(
      {},
      Promise.resolve({
        inbox: { list: null, facets: null, groups: null },
        outbox: cwBox(pageOf([cwRow(2)])),
      }),
    );

    expect(result.events).toHaveLength(1);
    expect(result.sourceErrors).toEqual([
      { key: "cwInbox", service: "caseworking", box: "inbox" },
    ]);
  });

  it("reports both Caseworking boxes when the CW backend is unconfigured", async () => {
    isCwConfigured.mockReturnValue(false);

    const result = await findEventsUseCase({});

    expect(result.sourceErrors).toEqual([
      { key: "cwInbox", service: "caseworking", box: "inbox" },
      { key: "cwOutbox", service: "caseworking", box: "outbox" },
    ]);
  });

  it("reports no CW sourceError when service=gas and the CW backend is unconfigured", async () => {
    isCwConfigured.mockReturnValue(false);

    const result = await findEventsUseCase({ service: "gas" });

    expect(result.sourceErrors).toEqual([]);
  });

  it("returns 200 with a gas outbox sourceError when only the GAS outbox read rejects, and still returns the other three sources' rows", async () => {
    findGasInboxPage.mockResolvedValue(pageOf([gasInboxDoc(1)]));
    findGasOutboxPage.mockRejectedValue(new Error("mongo down"));

    const result = await find(
      {},
      Promise.resolve(
        cwPage({ inbox: pageOf([cwRow(2)]), outbox: pageOf([cwRow(3)]) }),
      ),
    );

    expect(result.events).toHaveLength(3);
    expect(result.sourceErrors).toEqual([
      { key: "gasOutbox", service: "gas", box: "outbox" },
    ]);
    expect(logger.error).toHaveBeenCalled();
  });

  it("throws Boom 502 when both GAS reads reject", async () => {
    findGasInboxPage.mockRejectedValue(new Error("mongo down"));
    findGasOutboxPage.mockRejectedValue(new Error("mongo down"));

    await expect(find()).rejects.toMatchObject({
      output: { statusCode: 502 },
      message: "Events could not be loaded from GAS",
    });
  });

  it("throws Boom 400 for a tampered cursor before any source is queried", async () => {
    await expect(find({ cursor: "tampered" })).rejects.toMatchObject({
      output: { statusCode: 400 },
      message: "Cannot decode cursor",
    });

    expect(findGasInboxPage).not.toHaveBeenCalled();
    expect(findGasOutboxPage).not.toHaveBeenCalled();
  });

  it("orders sourceErrors gasInbox, gasOutbox, cwInbox, cwOutbox", async () => {
    findGasOutboxPage.mockRejectedValue(new Error("mongo down"));

    const result = await find({}, cwDown(Boom.unauthorized("nope")));

    expect(result.sourceErrors).toEqual([
      { key: "gasOutbox", service: "gas", box: "outbox" },
      { key: "cwInbox", service: "caseworking", box: "inbox" },
      { key: "cwOutbox", service: "caseworking", box: "outbox" },
    ]);
  });

  it("never logs the CW error object", async () => {
    const error = Boom.unauthorized("Unauthorized");
    error.data = { payload: { message: "SECRET-CW-BODY" } };

    await find({}, cwDown(error));

    expect(logger.warn).toHaveBeenCalledWith(
      "caseworking inbox unavailable: HTTP 401",
    );

    for (const call of logger.warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("SECRET-CW-BODY");
      expect(call).toHaveLength(1);
    }
  });

  it("returns an empty page with null cursors when every source is empty", async () => {
    const result = await find();

    expect(result).toEqual({
      events: [],
      pagination: { endCursor: null, hasNextPage: false },
      sourceErrors: [],
    });
  });
});

describe("findEventsUseCase q", () => {
  it("applies q to both GAS sources", async () => {
    await find({ q: "GLD-9B2" });

    for (const fetch of [findGasInboxPage, findGasOutboxPage]) {
      expect(fetch).toHaveBeenCalledWith(
        expect.objectContaining({ q: "GLD-9B2" }),
      );
    }
  });

  it("passes q through as undefined when it is not given", async () => {
    await find();

    expect(findGasInboxPage).toHaveBeenCalledWith(
      expect.objectContaining({ q: undefined }),
    );
  });

  it("never sends a kind to a GAS source", async () => {
    await find({ q: "GLD-9B2" });

    for (const fetch of [findGasInboxPage, findGasOutboxPage]) {
      expect(fetch.mock.calls[0][0]).not.toHaveProperty("kind");
    }
  });

  it("merges hits from more than one source for the same q", async () => {
    findGasOutboxPage.mockResolvedValue(pageOf([gasOutboxDoc(2)]));

    const { events } = await find(
      { q: "evt-2" },
      Promise.resolve(cwInboxRows([cwRow(1)])),
    );

    expect(events).toHaveLength(2);
  });

  it("merges hits from both Caseworking boxes of the one composite", async () => {
    const { events } = await find(
      { q: "evt-2" },
      Promise.resolve(
        cwPage({ inbox: pageOf([cwRow(1)]), outbox: pageOf([cwRow(2)]) }),
      ),
    );

    expect(events).toHaveLength(2);
  });
});

describe("findEventsUseCase from and to", () => {
  const FROM = "2026-06-16T00:00:00.000Z";
  const TO = "2026-06-16T23:59:59.999Z";

  it("forwards both bounds to both GAS sources", async () => {
    await find({ from: FROM, to: TO });

    for (const fetch of [findGasInboxPage, findGasOutboxPage]) {
      expect(fetch).toHaveBeenCalledWith(
        expect.objectContaining({ from: FROM, to: TO }),
      );
    }
  });

  it("forwards a single bound", async () => {
    await find({ from: FROM });

    expect(findGasOutboxPage).toHaveBeenCalledWith(
      expect.objectContaining({ from: FROM, to: undefined }),
    );
  });

  it("passes no bounds through when none were given", async () => {
    await find();

    expect(findGasInboxPage).toHaveBeenCalledWith(
      expect.objectContaining({ from: undefined, to: undefined }),
    );
  });
});
