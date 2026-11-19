import { beforeEach, describe, expect, it } from "vitest";
import { clearListGroups, registerListGroup, listGroups } from "./registry.js";

describe("List group registry", () => {
  beforeEach(() => {
    clearListGroups();
  });

  it("refuses a second group with the same id", () => {
    registerListGroup({ id: "gas.events" });

    expect(() => registerListGroup({ id: "gas.events" })).toThrow(
      'List group "gas.events" is already registered',
    );
  });

  it("lists groups in the order they were registered", () => {
    registerListGroup({ id: "cw.events" });
    registerListGroup({ id: "gas.events" });

    expect(listGroups().map(({ id }) => id)).toEqual([
      "cw.events",
      "gas.events",
    ]);
  });

  it("holds nothing once cleared", () => {
    registerListGroup({ id: "gas.events" });
    clearListGroups();

    expect(listGroups()).toEqual([]);
  });
});
