import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beforeDeadline } from "./before-deadline.js";

const late = () => new Error("late");

describe("beforeDeadline", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers what the reading answers in time", async () => {
    await expect(beforeDeadline(Promise.resolve(1), 100, late)).resolves.toBe(
      1,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails at the deadline while the reading still runs", async () => {
    const answer = beforeDeadline(new Promise(() => {}), 100, late);
    const failed = expect(answer).rejects.toThrow("late");

    await vi.advanceTimersByTimeAsync(100);

    await failed;
  });
});
