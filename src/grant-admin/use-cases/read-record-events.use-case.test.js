import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTimeline } from "../../common/buckets/engine.js";
import { logger } from "../../common/logger.js";
import { readCwTimeline } from "../repositories/cw-actuators.repository.js";
import {
  readApplicationEventsUseCase,
  readCaseEventsUseCase,
} from "./read-record-events.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("../../common/buckets/engine.js");
vi.mock("../repositories/cw-actuators.repository.js", () => ({
  describeError: vi.fn(() => "timeout"),
  readCwTimeline: vi.fn(),
}));

const row = ({ service, box, id, time, ...overrides }) => ({
  id,
  time,
  title: "case.create",
  subtitle: `event-${id}`,
  cells: { status: "COMPLETED", completedAt: null },
  link: { kind: "event", service, box, id },
  ...overrides,
});

const bucket = (id, label, rows, more = false) => ({ id, label, rows, more });

const OUTBOX_ROWS = [
  row({
    service: "gas",
    box: "outbox",
    id: "b",
    time: "2026-10-09T10:00:00.000Z",
    cells: { status: "COMPLETED", completedAt: "2026-10-09T10:00:01.500Z" },
  }),
  row({
    service: "gas",
    box: "outbox",
    id: "a",
    time: "2026-10-09T09:00:00.000Z",
  }),
];

const INBOX_ROWS = [
  row({
    service: "gas",
    box: "inbox",
    id: "c",
    time: "2026-10-09T10:00:00.000Z",
    title: "case.status.updated",
    cells: { status: "DEAD_LETTER", completedAt: null },
  }),
];

const timeline = (outbox = OUTBOX_ROWS, inbox = INBOX_ROWS) => ({
  buckets: [
    bucket("gas.outbox", "GAS outbox", outbox),
    bucket("gas.inbox", "GAS inbox", inbox),
  ],
});

describe("readApplicationEventsUseCase", () => {
  const read = () => readApplicationEventsUseCase({ ref: " ABC-123" });

  beforeEach(() => {
    readTimeline.mockResolvedValue(timeline());
  });

  it("searches this service's timeline for the application's ref, and asks Caseworking nothing", async () => {
    await read();

    expect(readTimeline).toHaveBeenCalledExactlyOnceWith("ref:abc-123");
    expect(readCwTimeline).not.toHaveBeenCalled();
  });

  it("merges the rows newest first, by time and then id, as event rows", async () => {
    const { content, sourceErrors } = await read();

    expect(content.events.rows.map(({ id }) => id)).toEqual(["c", "b", "a"]);
    expect(content.events.rows[0]).toEqual({
      service: "gas",
      box: "inbox",
      id: "c",
      eventId: "event-c",
      type: "case.status.updated",
      status: "DEAD_LETTER",
      statusLabel: "Dead letter",
      statusRole: "error",
      statusRetrying: false,
      createdAt: "2026-10-09T10:00:00.000Z",
      latency: null,
      latencyTitle: "Received to completed",
    });
    expect(content.events.rows[1]).toMatchObject({
      latency: "1.5s",
      latencyTitle: "Queued to delivered to SNS",
    });
    expect(content.events.more).toBe(false);
    expect(sourceErrors).toEqual([]);
  });

  it("falls back to the row id and the unrecognised name for a row without them", async () => {
    readTimeline.mockResolvedValue(
      timeline(
        [
          row({
            service: "gas",
            box: "outbox",
            id: "a",
            time: "2026-10-09T09:00:00.000Z",
            title: null,
            subtitle: null,
          }),
        ],
        [],
      ),
    );

    const [first] = (await read()).content.events.rows;

    expect(first).toMatchObject({ eventId: "a", type: "Unrecognised" });
  });

  it("says there is more when a bucket has more than it answered", async () => {
    readTimeline.mockResolvedValue({
      buckets: [
        bucket("gas.outbox", "GAS outbox", [], true),
        bucket("gas.inbox", "GAS inbox", []),
      ],
    });

    expect((await read()).content.events.more).toBe(true);
  });

  it("names a bucket that could not be read, and keeps the rest", async () => {
    readTimeline.mockResolvedValue(timeline(null));

    const { content, sourceErrors } = await read();

    expect(content.events.rows.map(({ id }) => id)).toEqual(["c"]);
    expect(sourceErrors).toEqual([{ hop: "GAS outbox" }]);
  });
});

describe("readCaseEventsUseCase", () => {
  const read = () =>
    readCaseEventsUseCase({
      workflowCode: "example-grant",
      caseRef: "ABC-123",
      actor: "Jo",
    });

  const CW_ROW = row({
    service: "caseworking",
    box: "inbox",
    id: "d",
    time: "2026-10-09T11:00:00.000Z",
  });

  beforeEach(() => {
    readCwTimeline.mockResolvedValue({
      buckets: [
        bucket("cw.outbox", "CW outbox", []),
        bucket("cw.inbox", "CW inbox", [CW_ROW], true),
      ],
    });
  });

  it("asks Caseworking once for the case's timeline, as the operator, and reads none of its own boxes", async () => {
    const { content, sourceErrors } = await read();

    expect(readCwTimeline).toHaveBeenCalledExactlyOnceWith(
      "case:example-grant:~41.~42.~43.-123",
      { actor: "Jo" },
    );
    expect(readTimeline).not.toHaveBeenCalled();
    expect(content.events.rows).toEqual([
      expect.objectContaining({
        service: "caseworking",
        box: "inbox",
        id: "d",
      }),
    ]);
    expect(content.events.more).toBe(true);
    expect(sourceErrors).toEqual([]);
  });

  it("names a Caseworking bucket that could not be read", async () => {
    readCwTimeline.mockResolvedValue({
      buckets: [
        bucket("cw.outbox", "CW outbox", null),
        bucket("cw.inbox", "CW inbox", [CW_ROW]),
      ],
    });

    const { content, sourceErrors } = await read();

    expect(content.events.rows).toHaveLength(1);
    expect(sourceErrors).toEqual([{ hop: "CW outbox" }]);
  });

  it("names Caseworking, with no rows, when it cannot be asked", async () => {
    const error = Boom.gatewayTimeout("timed out");
    error.data = { payload: "SECRET-CW-BODY" };
    readCwTimeline.mockRejectedValue(error);

    const { content, sourceErrors } = await read();

    expect(content.events).toEqual({ rows: [], more: false });
    expect(sourceErrors).toEqual([{ hop: "CW-BE" }]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Case events: caseworking unavailable (timeout)",
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("SECRET");
  });
});
