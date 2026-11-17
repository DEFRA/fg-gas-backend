import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { meterFor } from "../../common/explore/meter.js";
import { refuseQuery } from "../../common/explore/refusal.js";
import {
  CAPPED,
  MAX_WINDOWS,
  OUT_OF_TIME,
  readAnswerWindows,
  readInTurn,
} from "./windows.js";

const NOW = Date.UTC(2026, 10, 18, 10);

// A window that takes `ms` to read.
const taking =
  (ms, window = {}) =>
  async () => {
    vi.setSystemTime(Date.now() + ms);

    return window;
  };

const turn = (readWindow, extra = {}) => ({
  readWindow,
  endOf: () => null,
  keepsRowsOn: () => true,
  meter: meterFor(NOW + 10_000),
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("readInTurn", () => {
  it("reads no window it has no time for, as long as the last took and half again", async () => {
    const readWindow = vi.fn(taking(3_000));

    const read = await readInTurn(turn(readWindow));

    expect(readWindow).toHaveBeenCalledTimes(2);
    expect(read).toEqual({ windows: [{}, {}], short: OUT_OF_TIME });
  });

  it("reads on while there is time for one more", async () => {
    const readWindow = vi.fn(taking(1_000));
    const endOf = (windows) => (windows.length === 4 ? "last" : null);

    const read = await readInTurn(turn(readWindow, { endOf }));

    expect(read).toMatchObject({ ended: "last" });
    expect(readWindow).toHaveBeenCalledTimes(4);
  });

  it("ends where endOf says, even with no time left", async () => {
    const read = await readInTurn(turn(taking(9_000), { endOf: () => "done" }));

    expect(read).toEqual({ windows: [{}], ended: "done" });
  });

  it("stops at the cap", async () => {
    const readWindow = vi.fn(taking(0));

    const read = await readInTurn(turn(readWindow));

    expect(readWindow).toHaveBeenCalledTimes(MAX_WINDOWS);
    expect(read.short).toBe(CAPPED);
  });

  it("keeps the windows before a later one that fails as it allows", async () => {
    const full = refuseQuery("FULL");
    const readWindow = vi
      .fn()
      .mockResolvedValueOnce({ n: 1 })
      .mockRejectedValueOnce(full);

    const read = await readInTurn(turn(readWindow));

    expect(read).toEqual({ windows: [{ n: 1 }], failed: full });
  });

  it("refuses a first window that fails, and a later one it doesn't allow", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("first"));
    const later = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("later"));

    await expect(readInTurn(turn(failing))).rejects.toThrow("first");
    await expect(
      readInTurn(turn(later, { keepsRowsOn: () => false })),
    ).rejects.toThrow("later");
  });
});

describe("readAnswerWindows", () => {
  const answerTaking = (ms) => async () => {
    vi.setSystemTime(Date.now() + ms);

    return {
      rows: [{ cells: {} }],
      window: { to: null, end: false, positions: "p", skipped: 0 },
    };
  };

  it("stops before a window there is no time for, as 408 QUERY_TOO_SLOW, never reading it", async () => {
    const readAnswer = vi.fn(answerTaking(5_000));

    const answer = await readAnswerWindows({
      body: { windows: 5 },
      query: { columns: [{ path: "clientRef" }] },
      limit: 10,
      meter: meterFor(NOW + 10_000),
      readAnswer,
      stoppedBy: vi.fn(),
    });

    expect(readAnswer).toHaveBeenCalledTimes(1);
    expect(answer).toMatchObject({
      windowRows: [1],
      stopped: { statusCode: 408, code: "QUERY_TOO_SLOW" },
    });
  });
});
