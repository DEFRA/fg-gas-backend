import { describe, expect, it } from "vitest";
import { currentSearchesOf } from "./current-searches.js";

const search = (key) => ({
  fields: [{ key, label: key, path: `$.answers.${key}` }],
});

describe("currentSearchesOf", () => {
  it("answers each code with its current version's search and its count of config changes", () => {
    expect(
      currentSearchesOf(
        [
          { _id: "grant-a", versions: ["1.10.0", "1.9.0"] },
          { _id: "grant-b", versions: ["2.0.0"] },
        ],
        [
          { code: "grant-a", version: "1.9.0", search: search("older") },
          { code: "grant-a", version: "1.10.0", search: search("current") },
          { code: "grant-b", version: "2.0.0" },
        ],
        [{ _id: "grant-a", change: 7 }],
      ),
    ).toEqual([
      { value: "grant-a", search: search("current"), change: 7 },
      { value: "grant-b", search: null, change: 0 },
    ]);
  });

  it("falls back to the highest active version stored while a later one is not", () => {
    expect(
      currentSearchesOf(
        [{ _id: "grant-a", versions: ["1.2.0", "1.1.0", "1.0.0"] }],
        [
          { code: "grant-a", version: "1.0.0", search: search("oldest") },
          { code: "grant-a", version: "1.1.0", search: search("stored") },
        ],
        [{ _id: "grant-a", change: 3 }],
      ),
    ).toEqual([{ value: "grant-a", search: search("stored"), change: 3 }]);
  });

  it("leaves out a code none of whose active versions is stored", () => {
    expect(
      currentSearchesOf(
        [{ _id: "grant-a", versions: ["1.1.0"] }],
        [{ code: "grant-a", version: "1.0.0", search: search("draft") }],
        [{ _id: "grant-a", change: 1 }],
      ),
    ).toEqual([]);
  });

  it("answers nothing for no active versions", () => {
    expect(currentSearchesOf([], [], [])).toEqual([]);
  });
});
