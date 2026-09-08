import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventDetailPageUseCase } from "./event-detail-page.use-case.js";
import { findEventsUseCase } from "./find-events.use-case.js";
import { getEventUseCase } from "./get-event.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("./get-event.use-case.js");
vi.mock("./find-events.use-case.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";
const EVENT_ID = "evt-detail-1";

const key = { service: "gas", box: "outbox", id: ID, caller: "grants-ui" };

const detail = (overrides = {}) => ({
  service: "gas",
  box: "outbox",
  id: ID,
  eventId: EVENT_ID,
  status: "DEAD_LETTER",
  payload: { data: { clientRef: "CLIENT-REF" } },
  attemptHistory: [],
  lastRedrive: null,
  ...overrides,
});

const hop = (overrides = {}) => ({
  service: "gas",
  box: "inbox",
  id: "665f1c2e9a1b2c3d4e5f6a7c",
  hop: "GAS Inbox",
  status: "COMPLETED",
  statusLabel: "Completed",
  statusRole: "success",
  statusRetrying: false,
  startedAt: "2026-06-16T10:00:00.000Z",
  took: "1.2s",
  ...overrides,
});

// The list use case answers with the one page in both shapes; the journey
// reads the hops.
const page = (hops) => ({
  events: hops.map(({ service, box, id }) => ({ service, box, id })),
  hops,
  pagination: {
    startCursor: null,
    endCursor: null,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  sourceErrors: [],
});

// One Caseworking list row, as Caseworking's own detail answer carries it: the
// service searched both its boxes for this event's id while answering.
const cwHop = (overrides = {}) => ({
  _id: "665f1c2e9a1b2c3d4e5f6a7d",
  eventId: EVENT_ID,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  status: "COMPLETED",
  completionAttempts: 1,
  maxAttempts: 9,
  createdAt: "2026-06-16T10:00:00.000Z",
  completedAt: "2026-06-16T10:00:01.000Z",
  ...overrides,
});

const sharedCwPage = () => findEventsUseCase.mock.calls[0][0].caseworking;

beforeEach(() => {
  vi.clearAllMocks();
  getEventUseCase.mockResolvedValue({ event: detail(), cwHops: null });
  findEventsUseCase.mockResolvedValue(
    page([hop(), hop({ id: ID, box: "outbox", hop: "GAS Outbox" })]),
  );
});

describe("eventDetailPageUseCase", () => {
  it("answers with the event and its journey in one body", async () => {
    const result = await eventDetailPageUseCase(key);

    expect(result).toEqual({
      ...detail(),
      journey: [hop(), hop({ id: ID, box: "outbox", hop: "GAS Outbox" })],
      journeyTruncated: false,
      sectionErrors: [],
    });
  });

  it("keeps every field the detail already returned", async () => {
    const result = await eventDetailPageUseCase(key);

    expect(result.payload).toEqual({ data: { clientRef: "CLIENT-REF" } });
    expect(result.eventId).toBe(EVENT_ID);
    expect(result.attemptHistory).toEqual([]);
  });

  it("adds exactly three keys to the detail body", async () => {
    const added = Object.keys(await eventDetailPageUseCase(key)).filter(
      (name) => !(name in detail()),
    );

    expect(added.sort()).toEqual([
      "journey",
      "journeyTruncated",
      "sectionErrors",
    ]);
  });

  // One page of a merged list: an event with more hops than a page loses the
  // OLDEST of them, which is its origin - the worst end to drop in silence.
  it("says when there were more hops than the page could hold", async () => {
    findEventsUseCase.mockResolvedValue({
      hops: [],
      pagination: { hasNextPage: true },
    });

    expect((await eventDetailPageUseCase(key)).journeyTruncated).toBe(true);
  });

  it("says nothing of the sort when every hop fitted", async () => {
    expect((await eventDetailPageUseCase(key)).journeyTruncated).toBe(false);
  });

  // Absent is not truncated: `journey: null` already says the journey could
  // not be read, and claiming truncation too would be counting hops nobody
  // ever saw.
  it("is not truncated when the journey could not be read at all", async () => {
    findEventsUseCase.mockRejectedValue(Boom.badGateway("nope"));

    const page = await eventDetailPageUseCase(key);

    expect(page.journey).toBeNull();
    expect(page.journeyTruncated).toBe(false);
  });

  // The service vocabulary left with the hop link it existed for: neither the
  // list nor the detail narrows to a service off a row any more.
  it("names no service vocabulary, which nothing on the page draws", async () => {
    const page = await eventDetailPageUseCase(key);

    expect(page).not.toHaveProperty("services");
  });

  it("passes the params and the caller to the detail use case, so the read is still audited", async () => {
    await eventDetailPageUseCase(key);

    expect(getEventUseCase).toHaveBeenCalledTimes(1);
    expect(getEventUseCase).toHaveBeenCalledWith(key);
  });

  it("reads the journey through the list use case, filtered on the event id", async () => {
    await eventDetailPageUseCase(key);

    expect(findEventsUseCase).toHaveBeenCalledWith({
      q: EVENT_ID,
      direction: "forward",
      audit: "include",
    });
  });

  it("asks for audit hops explicitly, unlike a default list", async () => {
    await eventDetailPageUseCase(key);

    expect(findEventsUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ audit: "include" }),
    );
  });

  // The URL addresses a row by its Mongo _id; nothing knows the event id until
  // the detail has answered, so these cannot be fanned out in parallel.
  it("does not look for the journey until the detail has answered", async () => {
    const order = [];
    getEventUseCase.mockImplementation(async () => {
      order.push("detail");

      return { event: detail(), cwHops: null };
    });
    findEventsUseCase.mockImplementation(async () => {
      order.push("journey");

      return page([]);
    });

    await eventDetailPageUseCase(key);

    expect(order).toEqual(["detail", "journey"]);
  });

  it("keeps the event's own hop, which the frontend marks as this event", async () => {
    findEventsUseCase.mockResolvedValue(page([hop({ id: ID })]));

    expect((await eventDetailPageUseCase(key)).journey).toEqual([
      hop({ id: ID }),
    ]);
  });

  it("answers with an empty journey when nothing else carries the id", async () => {
    findEventsUseCase.mockResolvedValue(page([]));

    const result = await eventDetailPageUseCase(key);

    expect(result.journey).toEqual([]);
    expect(result.sectionErrors).toEqual([]);
  });

  it("leaves the fan-out to read Caseworking for a GAS event", async () => {
    await eventDetailPageUseCase(key);

    expect(sharedCwPage()).toBeUndefined();
  });

  it("hands Caseworking's own hops to the journey rather than reading them again", async () => {
    const row = cwHop();
    getEventUseCase.mockResolvedValue({
      event: detail({ service: "caseworking" }),
      cwHops: { inbox: [row], outbox: [] },
    });

    await eventDetailPageUseCase(key);

    await expect(sharedCwPage()).resolves.toEqual({
      inbox: {
        list: { data: [row], pagination: {} },
        facets: null,
        groups: null,
      },
      outbox: {
        list: { data: [], pagination: {} },
        facets: null,
        groups: null,
      },
    });
  });

  it("passes on a box Caseworking could not search as the gap it is", async () => {
    getEventUseCase.mockResolvedValue({
      event: detail({ service: "caseworking" }),
      cwHops: { inbox: null, outbox: [] },
    });

    await eventDetailPageUseCase(key);

    const page = await sharedCwPage();

    expect(page.inbox.list).toBeNull();
    expect(page.outbox.list).toEqual({ data: [], pagination: {} });
  });

  it("keeps only the hops from the journey read, not its rows or its pagination", async () => {
    const result = await eventDetailPageUseCase(key);

    expect(result).not.toHaveProperty("pagination");
    expect(result).not.toHaveProperty("sourceErrors");
    expect(result).not.toHaveProperty("events");
  });
});

describe("eventDetailPageUseCase degradation", () => {
  it("nulls the journey and names the section when the journey fails", async () => {
    findEventsUseCase.mockRejectedValue(
      Boom.badGateway("Events could not be loaded from GAS"),
    );

    const result = await eventDetailPageUseCase(key);

    expect(result.journey).toBeNull();
    expect(result.sectionErrors).toEqual([
      { section: "journey", message: "Events could not be loaded from GAS" },
    ]);
    expect(result.id).toBe(ID);
    expect(result.payload).toEqual({ data: { clientRef: "CLIENT-REF" } });
  });

  it("reports a journey failure without leaking what a source said", async () => {
    findEventsUseCase.mockRejectedValue(
      new Error("MongoServerError: SECRET-CONNECTION-STRING"),
    );

    const result = await eventDetailPageUseCase(key);

    expect(result.sectionErrors).toEqual([
      { section: "journey", message: "read failed" },
    ]);
    expect(JSON.stringify(result)).not.toContain("SECRET-CONNECTION-STRING");
  });

  it("stays a 404 when the event is not found, and never reads the journey", async () => {
    getEventUseCase.mockRejectedValue(
      Boom.notFound(`gas outbox event "${ID}" not found`),
    );

    await expect(eventDetailPageUseCase(key)).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
    expect(findEventsUseCase).not.toHaveBeenCalled();
  });

  it("stays a 502 when the event could not be read", async () => {
    getEventUseCase.mockRejectedValue(
      Boom.badGateway("Caseworking outbox unavailable"),
    );

    await expect(eventDetailPageUseCase(key)).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
    expect(findEventsUseCase).not.toHaveBeenCalled();
  });
});
