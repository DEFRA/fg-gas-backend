import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPT_HISTORY,
  appendAttempt,
  claimExpiredAttempt,
  claimExpiredError,
  normaliseAttemptHistory,
  pushAttemptUpdate,
  toAttemptEntry,
  toLastError,
} from "./last-error.js";

describe("toLastError", () => {
  it("captures the error's name and message", () => {
    expect(toLastError(new TypeError("cannot read x"))).toEqual({
      name: "TypeError",
      message: "cannot read x",
      at: expect.any(String),
      stack: expect.stringContaining("TypeError: cannot read x"),
    });
  });

  it("stamps `at` as an ISO instant", () => {
    const { at } = toLastError(new Error("boom"));

    expect(at).toEqual(new Date(at).toISOString());
  });

  it("truncates a message longer than 1024 characters", () => {
    const { message } = toLastError(new Error("x".repeat(5000)));

    expect(message).toHaveLength(1024);
    expect(message).toEqual("x".repeat(1024));
  });

  it("keeps a message of exactly 1024 characters whole", () => {
    expect(toLastError(new Error("x".repeat(1024))).message).toHaveLength(1024);
  });

  it("names an error that carries no name Error", () => {
    expect(toLastError({ message: "no name here" })).toEqual({
      name: "Error",
      message: "no name here",
      at: expect.any(String),
      stack: null,
    });
  });

  it("uses a thrown string as the message", () => {
    expect(toLastError("just a string")).toEqual({
      name: "Error",
      message: "just a string",
      at: expect.any(String),
      // Nothing with a stack was thrown, so there is no stack to record -
      // an absence, not an empty string.
      stack: null,
    });
  });

  it("returns null for no error at all", () => {
    expect(toLastError(undefined)).toBeNull();
    expect(toLastError(null)).toBeNull();
  });

  // Stored for diagnosis, never served: the outbound mappers rebuild a
  // `lastError` from its three contract keys, and those rebuilds are tested
  // where they live.
  it("stores the stack", () => {
    expect(Object.keys(toLastError(new Error("boom")))).toEqual([
      "name",
      "message",
      "at",
      "stack",
    ]);
    expect(toLastError(new Error("boom")).stack).toContain("Error: boom");
  });

  it("caps a pathological stack at 8192 characters", () => {
    const error = new Error("boom");
    error.stack = "x".repeat(20000);

    expect(toLastError(error).stack).toHaveLength(8192);
  });

  it("keeps a stack of exactly 8192 characters whole", () => {
    const error = new Error("boom");
    error.stack = "x".repeat(8192);

    expect(toLastError(error).stack).toHaveLength(8192);
  });

  it("records an empty stack as an absence", () => {
    const error = new Error("boom");
    error.stack = "";

    expect(toLastError(error).stack).toBeNull();
  });
});

describe("claimExpiredError", () => {
  it("names the sweep rather than an exception", () => {
    expect(claimExpiredError()).toEqual({
      name: "ClaimExpired",
      message: "claim expired before completion",
      at: expect.any(String),
    });
  });
});

describe("toAttemptEntry", () => {
  it("records the same fields as lastError, at first", () => {
    expect(toAttemptEntry(new TypeError("boom"))).toEqual({
      at: expect.any(String),
      name: "TypeError",
      message: "boom",
      stack: expect.stringContaining("TypeError: boom"),
    });
  });

  it("truncates the message to 512 characters, harder than lastError does", () => {
    const long = "x".repeat(2000);

    expect(toAttemptEntry(new Error(long)).message).toHaveLength(512);
    expect(toLastError(new Error(long)).message).toHaveLength(1024);
  });

  it("uses a thrown string as the message, and records no stack", () => {
    expect(toAttemptEntry("just a string")).toEqual({
      at: expect.any(String),
      name: "Error",
      message: "just a string",
      // Nothing with a stack was thrown, so the detail page draws no expander
      // on this attempt: there is nothing to reveal.
      stack: null,
    });
  });

  // Ten of these live on every document, so the attempt cap is half the
  // `lastError` one: 4KB apiece puts a worst-case history at 40KB.
  it("caps the stack harder than lastError does", () => {
    const error = new Error("boom");
    error.stack = "x".repeat(20000);

    expect(toAttemptEntry(error).stack).toHaveLength(4096);
    expect(toLastError(error).stack).toHaveLength(8192);
  });

  it("keeps a stack of exactly 4096 characters whole", () => {
    const error = new Error("boom");
    error.stack = "x".repeat(4096);

    expect(toAttemptEntry(error).stack).toHaveLength(4096);
  });

  it("records an empty stack as an absence", () => {
    const error = new Error("boom");
    error.stack = "";

    expect(toAttemptEntry(error).stack).toBeNull();
  });

  it("returns null for no error at all", () => {
    expect(toAttemptEntry(undefined)).toBeNull();
    expect(toAttemptEntry(null)).toBeNull();
  });
});

describe("claimExpiredAttempt", () => {
  // Nothing threw - the worker stopped answering - so there is no stack, and
  // the detail page draws no expander on this attempt.
  it("names the sweep rather than an exception, and carries no stack", () => {
    expect(claimExpiredAttempt()).toEqual({
      at: expect.any(String),
      name: "ClaimExpired",
      message: "claim expired before completion",
      stack: null,
    });
  });
});

describe("normaliseAttemptHistory", () => {
  it("reads a missing or malformed history as an empty array", () => {
    expect(normaliseAttemptHistory(undefined)).toEqual([]);
    expect(normaliseAttemptHistory(null)).toEqual([]);
    expect(normaliseAttemptHistory("nope")).toEqual([]);
    expect(normaliseAttemptHistory({ 0: "nope" })).toEqual([]);
  });

  it("trims a stored history that is already over the cap", () => {
    const stored = Array.from({ length: 14 }, (_, i) => ({ message: `${i}` }));

    const history = normaliseAttemptHistory(stored);

    expect(history).toHaveLength(MAX_ATTEMPT_HISTORY);
    expect(history.at(0).message).toBe("4");
    expect(history.at(-1).message).toBe("13");
  });
});

describe("appendAttempt", () => {
  it("appends oldest first", () => {
    const first = toAttemptEntry(new Error("one"));
    const second = toAttemptEntry(new Error("two"));

    expect(appendAttempt(appendAttempt([], first), second)).toEqual([
      first,
      second,
    ]);
  });

  it("keeps only the ten most recent entries", () => {
    let history = [];

    for (let i = 0; i < 25; i++) {
      history = appendAttempt(history, toAttemptEntry(new Error(`${i}`)));
    }

    expect(history).toHaveLength(MAX_ATTEMPT_HISTORY);
    expect(history.map((entry) => entry.message)).toEqual([
      "15",
      "16",
      "17",
      "18",
      "19",
      "20",
      "21",
      "22",
      "23",
      "24",
    ]);
  });

  it("appends nothing when there is no entry", () => {
    const entry = toAttemptEntry(new Error("one"));

    expect(appendAttempt([entry], null)).toEqual([entry]);
    expect(appendAttempt(undefined, null)).toEqual([]);
  });

  it("does not mutate the history it was given", () => {
    const history = [];

    appendAttempt(history, toAttemptEntry(new Error("one")));

    expect(history).toEqual([]);
  });
});

describe("pushAttemptUpdate", () => {
  it("is a $push that caps the array server-side, for the updateMany sweeps", () => {
    const entry = claimExpiredAttempt();

    expect(pushAttemptUpdate(entry)).toEqual({
      attemptHistory: { $each: [entry], $slice: -MAX_ATTEMPT_HISTORY },
    });
  });

  it("slices to exactly ten", () => {
    expect(pushAttemptUpdate({}).attemptHistory.$slice).toBe(-10);
  });
});
