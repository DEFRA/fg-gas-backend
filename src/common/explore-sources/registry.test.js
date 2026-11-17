import { beforeEach, describe, expect, it } from "vitest";
import {
  clearExploreSources,
  findExploreSource,
  listExploreSources,
  registerExploreSource,
} from "./registry.js";

describe("Explore source registry", () => {
  beforeEach(() => {
    clearExploreSources();
  });

  it("finds a registered source by name", () => {
    const source = { name: "one" };

    registerExploreSource(source);

    expect(findExploreSource("one")).toBe(source);
  });

  it("answers undefined for a name it does not hold", () => {
    expect(findExploreSource("none")).toBeUndefined();
  });

  it("refuses a second source with the same name", () => {
    registerExploreSource({ name: "one" });

    expect(() => registerExploreSource({ name: "one" })).toThrow(
      'Explore source "one" is already registered',
    );
  });

  it("lists sources in the order they were registered", () => {
    registerExploreSource({ name: "two" });
    registerExploreSource({ name: "one" });

    expect(listExploreSources().map(({ name }) => name)).toEqual([
      "two",
      "one",
    ]);
  });

  it("holds nothing once cleared", () => {
    registerExploreSource({ name: "one" });
    clearExploreSources();

    expect(listExploreSources()).toEqual([]);
  });
});
