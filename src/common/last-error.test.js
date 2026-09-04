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
    });
  });

  it("uses a thrown string as the message", () => {
    expect(toLastError("just a string")).toEqual({
      name: "Error",
      message: "just a string",
      at: expect.any(String),
    });
  });

  it("returns null for no error at all", () => {
    expect(toLastError(undefined)).toBeNull();
    expect(toLastError(null)).toBeNull();
  });

  it("never carries the stack", () => {
    expect(Object.keys(toLastError(new Error("boom")))).toEqual([
      "name",
      "message",
      "at",
    ]);
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
  it("records the same three fields as lastError, at first", () => {
    expect(toAttemptEntry(new TypeError("boom"))).toEqual({
      at: expect.any(String),
      name: "TypeError",
      message: "boom",
    });
  });

  it("truncates the message to 512 characters, harder than lastError does", () => {
    const long = "x".repeat(2000);

    expect(toAttemptEntry(new Error(long)).message).toHaveLength(512);
    expect(toLastError(new Error(long)).message).toHaveLength(1024);
  });

  it("uses a thrown string as the message", () => {
    expect(toAttemptEntry("just a string")).toEqual({
      at: expect.any(String),
      name: "Error",
      message: "just a string",
    });
  });

  it("never carries the stack", () => {
    expect(Object.keys(toAttemptEntry(new Error("boom")))).toEqual([
      "at",
      "name",
      "message",
    ]);
  });

  it("returns null for no error at all", () => {
    expect(toAttemptEntry(undefined)).toBeNull();
    expect(toAttemptEntry(null)).toBeNull();
  });
});

describe("claimExpiredAttempt", () => {
  it("names the sweep rather than an exception", () => {
    expect(claimExpiredAttempt()).toEqual({
      at: expect.any(String),
      name: "ClaimExpired",
      message: "claim expired before completion",
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
