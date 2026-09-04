import Boom from "@hapi/boom";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { findPage as findGasInboxPage } from "../../grants/repositories/inbox.repository.js";
import { findPage as findGasOutboxPage } from "../../grants/repositories/outbox.repository.js";
import {
  findCwInboxPage,
  findCwOutboxPage,
  isCwConfigured,
} from "../repositories/cw-actuators.repository.js";
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
    findCwInboxPage: vi.fn(),
    findCwOutboxPage: vi.fn(),
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
  eventTime: at(n),
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
  source: "GAS",
  segregationRef: `ref-${n}`,
  status: "PUBLISHED",
  completionAttempts: 1,
  maxAttempts: 9,
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  createdAt: at(n),
  lastFailureAt: null,
  completedAt: null,
  ...overrides,
});

const emptyPagination = {
  startCursor: null,
  endCursor: null,
  hasNextPage: false,
  hasPreviousPage: false,
};

const pageOf = (data) => ({ data, pagination: { ...emptyPagination } });

const emptyPage = () => pageOf([]);

beforeEach(() => {
  isCwConfigured.mockReturnValue(true);
  findGasInboxPage.mockResolvedValue(emptyPage());
  findGasOutboxPage.mockResolvedValue(emptyPage());
  findCwInboxPage.mockResolvedValue(emptyPage());
  findCwOutboxPage.mockResolvedValue(emptyPage());
});

describe("findEventsUseCase", () => {
  it("with no filters queries all four sources with a null cursor and pageSize 20", async () => {
    await findEventsUseCase({ direction: "forward" });

    for (const fetchPage of [
      findGasInboxPage,
      findGasOutboxPage,
      findCwInboxPage,
      findCwOutboxPage,
    ]) {
      expect(fetchPage).toHaveBeenCalledWith({
        cursor: null,
        direction: "forward",
        status: undefined,
        pageSize: 20,
      });
    }
  });

  it("merges rows from four sources newest first and returns 20", async () => {
    findGasInboxPage.mockResolvedValue(
      pageOf(Array.from({ length: 8 }, (_, i) => gasInboxDoc(i + 1))),
    );
    findGasOutboxPage.mockResolvedValue(
      pageOf(Array.from({ length: 8 }, (_, i) => gasOutboxDoc(i + 11))),
    );
    findCwInboxPage.mockResolvedValue(
      pageOf(Array.from({ length: 8 }, (_, i) => cwRow(i + 21))),
    );
    findCwOutboxPage.mockResolvedValue(
      pageOf(Array.from({ length: 8 }, (_, i) => cwRow(i + 31))),
    );

    const result = await findEventsUseCase({ direction: "forward" });

    expect(result.events).toHaveLength(20);
    const times = result.events.map((event) => event.createdAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(result.pagination.hasNextPage).toBe(true);
  });

  it("passes the per-source slice from a composite cursor to each source", async () => {
    const slices = {
      gasInbox: encodeSourceCursor("gasInbox", {
        cursorValue: at(5),
        id: hexId(5),
      }),
      gasOutbox: encodeSourceCursor("gasOutbox", {
        cursorValue: at(6),
        id: hexId(6),
      }),
      cwInbox: null,
      cwOutbox: null,
    };

    await findEventsUseCase({
      cursor: encodeCompositeCursor(slices),
      direction: "forward",
    });

    expect(findGasInboxPage.mock.calls[0][0].cursor).toEqual(slices.gasInbox);
    expect(findGasOutboxPage.mock.calls[0][0].cursor).toEqual(slices.gasOutbox);
    expect(findCwInboxPage.mock.calls[0][0].cursor).toBeNull();
  });

  it("passes status to all four sources", async () => {
    await findEventsUseCase({ direction: "forward", status: "DEAD_LETTER" });

    for (const fetchPage of [
      findGasInboxPage,
      findGasOutboxPage,
      findCwInboxPage,
      findCwOutboxPage,
    ]) {
      expect(fetchPage.mock.calls[0][0].status).toEqual("DEAD_LETTER");
    }
  });

  it("with service=gas queries only the two GAS sources and reports no sourceErrors", async () => {
    const result = await findEventsUseCase({
      direction: "forward",
      service: "gas",
    });

    expect(findGasInboxPage).toHaveBeenCalled();
    expect(findGasOutboxPage).toHaveBeenCalled();
    expect(findCwInboxPage).not.toHaveBeenCalled();
    expect(findCwOutboxPage).not.toHaveBeenCalled();
    expect(result.sourceErrors).toEqual([]);
  });

  it("with service=caseworking queries only the two CW sources", async () => {
    await findEventsUseCase({ direction: "forward", service: "caseworking" });

    expect(findGasInboxPage).not.toHaveBeenCalled();
    expect(findGasOutboxPage).not.toHaveBeenCalled();
    expect(findCwInboxPage).toHaveBeenCalled();
    expect(findCwOutboxPage).toHaveBeenCalled();
  });

  it("reports a caseworking sourceError and still returns GAS rows when the CW inbox call rejects", async () => {
    findGasInboxPage.mockResolvedValue(pageOf([gasInboxDoc(1)]));
    findCwInboxPage.mockRejectedValue(Boom.gatewayTimeout("timeout"));

    const result = await findEventsUseCase({ direction: "forward" });

    expect(result.events).toHaveLength(1);
    expect(result.sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "timeout" },
    ]);
  });

  it("reports two not configured sourceErrors and makes no HTTP call when the CW backend is unconfigured", async () => {
    isCwConfigured.mockReturnValue(false);

    const result = await findEventsUseCase({ direction: "forward" });

    expect(findCwInboxPage).not.toHaveBeenCalled();
    expect(findCwOutboxPage).not.toHaveBeenCalled();
    expect(result.sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "not configured" },
      { service: "caseworking", box: "outbox", message: "not configured" },
    ]);
  });

  it("reports no CW sourceError when service=gas and the CW backend is unconfigured", async () => {
    isCwConfigured.mockReturnValue(false);

    const result = await findEventsUseCase({
      direction: "forward",
      service: "gas",
    });

    expect(result.sourceErrors).toEqual([]);
  });

  it("returns 200 with a gas outbox sourceError when only the GAS outbox read rejects, and still returns the other three sources' rows", async () => {
    findGasInboxPage.mockResolvedValue(pageOf([gasInboxDoc(1)]));
    findCwInboxPage.mockResolvedValue(pageOf([cwRow(2)]));
    findCwOutboxPage.mockResolvedValue(pageOf([cwRow(3)]));
    findGasOutboxPage.mockRejectedValue(new Error("mongo down"));

    const result = await findEventsUseCase({ direction: "forward" });

    expect(result.events).toHaveLength(3);
    expect(result.sourceErrors).toEqual([
      { service: "gas", box: "outbox", message: "read failed" },
    ]);
    expect(logger.error).toHaveBeenCalled();
  });

  it("throws Boom 502 when both GAS reads reject", async () => {
    findGasInboxPage.mockRejectedValue(new Error("mongo down"));
    findGasOutboxPage.mockRejectedValue(new Error("mongo down"));

    await expect(
      findEventsUseCase({ direction: "forward" }),
    ).rejects.toMatchObject({
      output: { statusCode: 502 },
      message: "Events could not be loaded from GAS",
    });
  });

  it("throws Boom 400 for a tampered cursor before any source is queried", async () => {
    await expect(
      findEventsUseCase({ cursor: "tampered", direction: "forward" }),
    ).rejects.toMatchObject({
      output: { statusCode: 400 },
      message: "Cannot decode cursor",
    });

    expect(findGasInboxPage).not.toHaveBeenCalled();
    expect(findGasOutboxPage).not.toHaveBeenCalled();
    expect(findCwInboxPage).not.toHaveBeenCalled();
    expect(findCwOutboxPage).not.toHaveBeenCalled();
  });

  it("sets maxAttempts from inboxMaxRetries for GAS inbox rows and from the CW row for CW rows", async () => {
    findGasInboxPage.mockResolvedValue(pageOf([gasInboxDoc(1)]));
    findGasOutboxPage.mockResolvedValue(pageOf([gasOutboxDoc(2)]));
    findCwInboxPage.mockResolvedValue(pageOf([cwRow(3)]));

    const result = await findEventsUseCase({ direction: "forward" });
    const byBox = Object.fromEntries(
      result.events.map((event) => [`${event.service}/${event.box}`, event]),
    );

    expect(byBox["gas/inbox"].maxAttempts).toEqual(INBOX_MAX_RETRIES);
    expect(byBox["gas/outbox"].maxAttempts).toEqual(OUTBOX_MAX_RETRIES);
    expect(byBox["caseworking/inbox"].maxAttempts).toEqual(9);
  });

  it("orders sourceErrors gasInbox, gasOutbox, cwInbox, cwOutbox", async () => {
    findCwOutboxPage.mockRejectedValue(Boom.unauthorized("nope"));
    findCwInboxPage.mockRejectedValue(Boom.unauthorized("nope"));
    findGasOutboxPage.mockRejectedValue(new Error("mongo down"));

    const result = await findEventsUseCase({ direction: "forward" });

    expect(result.sourceErrors).toEqual([
      { service: "gas", box: "outbox", message: "read failed" },
      { service: "caseworking", box: "inbox", message: "HTTP 401" },
      { service: "caseworking", box: "outbox", message: "HTTP 401" },
    ]);
  });

  it("never logs the CW error object", async () => {
    const error = Boom.unauthorized("Unauthorized");
    error.data = { payload: { message: "SECRET-CW-BODY" } };
    findCwInboxPage.mockRejectedValue(error);

    await findEventsUseCase({ direction: "forward" });

    expect(logger.warn).toHaveBeenCalledWith(
      { service: "caseworking", box: "inbox" },
      "caseworking inbox unavailable: HTTP 401",
    );

    for (const call of logger.warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("SECRET-CW-BODY");
      expect(call[0]).not.toHaveProperty("data");
      expect(call[0]).not.toHaveProperty("payload");
    }
  });

  it("returns an empty page with null cursors when every source is empty", async () => {
    const result = await findEventsUseCase({ direction: "forward" });

    expect(result).toEqual({
      events: [],
      pagination: {
        startCursor: null,
        endCursor: null,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      sourceErrors: [],
    });
  });
});

describe("findEventsUseCase q", () => {
  beforeEach(() => {
    isCwConfigured.mockReturnValue(true);
    findGasInboxPage.mockResolvedValue(emptyPage());
    findGasOutboxPage.mockResolvedValue(emptyPage());
    findCwInboxPage.mockResolvedValue(emptyPage());
    findCwOutboxPage.mockResolvedValue(emptyPage());
  });

  it("applies q to every selected source", async () => {
    await findEventsUseCase({ direction: "forward", q: "GLD-9B2" });

    for (const fetch of [
      findGasInboxPage,
      findGasOutboxPage,
      findCwInboxPage,
      findCwOutboxPage,
    ]) {
      expect(fetch).toHaveBeenCalledWith(
        expect.objectContaining({ q: "GLD-9B2" }),
      );
    }
  });

  it("forwards q to Caseworking alongside status and the cursor slice", async () => {
    await findEventsUseCase({
      direction: "forward",
      status: "FAILED",
      q: "evt-1",
    });

    expect(findCwInboxPage).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAILED",
        q: "evt-1",
        direction: "forward",
      }),
    );
  });

  it("passes q through as undefined when it is not given", async () => {
    await findEventsUseCase({ direction: "forward" });

    expect(findGasInboxPage).toHaveBeenCalledWith(
      expect.objectContaining({ q: undefined }),
    );
  });

  // The TYPE filter is gone: nothing about a row's kind reaches a source.
  it("never sends a kind to any source", async () => {
    await findEventsUseCase({ direction: "forward", q: "GLD-9B2" });

    for (const fetch of [
      findGasInboxPage,
      findGasOutboxPage,
      findCwInboxPage,
      findCwOutboxPage,
    ]) {
      expect(fetch.mock.calls[0][0]).not.toHaveProperty("kind");
    }
  });

  it("merges hits from more than one source for the same q", async () => {
    findGasOutboxPage.mockResolvedValue(pageOf([gasOutboxDoc(2)]));
    findCwInboxPage.mockResolvedValue(pageOf([cwRow(1)]));

    const { events } = await findEventsUseCase({
      direction: "forward",
      q: "evt-2",
    });

    expect(events).toHaveLength(2);
  });
});

describe("findEventsUseCase from and to", () => {
  const emptyPage = () => ({
    data: [],
    pagination: {
      startCursor: null,
      endCursor: null,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  });

  const FROM = "2026-06-16T00:00:00.000Z";
  const TO = "2026-06-16T23:59:59.999Z";

  beforeEach(() => {
    isCwConfigured.mockReturnValue(true);
    findGasInboxPage.mockResolvedValue(emptyPage());
    findGasOutboxPage.mockResolvedValue(emptyPage());
    findCwInboxPage.mockResolvedValue(emptyPage());
    findCwOutboxPage.mockResolvedValue(emptyPage());
  });

  it("forwards both bounds to every source, GAS and Caseworking alike", async () => {
    await findEventsUseCase({ direction: "forward", from: FROM, to: TO });

    for (const fetch of [
      findGasInboxPage,
      findGasOutboxPage,
      findCwInboxPage,
      findCwOutboxPage,
    ]) {
      expect(fetch).toHaveBeenCalledWith(
        expect.objectContaining({ from: FROM, to: TO }),
      );
    }
  });

  it("forwards a single bound", async () => {
    await findEventsUseCase({ direction: "forward", from: FROM });

    expect(findCwInboxPage).toHaveBeenCalledWith(
      expect.objectContaining({ from: FROM, to: undefined }),
    );
  });

  it("passes no bounds through when none were given", async () => {
    await findEventsUseCase({ direction: "forward" });

    expect(findGasInboxPage).toHaveBeenCalledWith(
      expect.objectContaining({ from: undefined, to: undefined }),
    );
  });
});
