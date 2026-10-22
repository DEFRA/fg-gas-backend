import { describe, expect, it } from "vitest";
import { FetchStatus, fetchStatusRank } from "./fetch-status.js";

describe("fetchStatusRank", () => {
  it("ranks every fetch status once, best first", () => {
    expect(fetchStatusRank).toEqual([
      FetchStatus.Fetched,
      FetchStatus.Pending,
      FetchStatus.TransientError,
      FetchStatus.PermanentError,
    ]);
    expect([...fetchStatusRank].sort()).toEqual(
      Object.values(FetchStatus).sort(),
    );
  });
});
