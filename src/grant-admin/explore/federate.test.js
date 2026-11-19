import { describe, expect, it } from "vitest";
import { servicesAsked } from "./federate.js";
import { eventsSource } from "../../events/explore/events.source.js";

const test = (path, op, values) => ({ path, op, values });

describe("servicesAsked", () => {
  it.each([
    ["no test", null, ["GAS", "CW"]],
    ["service GAS", test("service", "eq", ["GAS"]), ["GAS"]],
    ["service in CW", test("service", "in", ["CW"]), ["CW"]],
    ["service not CW", test("service", "ne", ["CW"]), ["GAS"]],
    ["service not in GAS or CW", test("service", "nin", ["GAS", "CW"]), []],
    ["a box", test("box", "eq", ["inbox"]), ["GAS", "CW"]],
    [
      "a service and a box",
      { all: [test("service", "eq", ["CW"]), test("box", "eq", ["outbox"])] },
      ["CW"],
    ],
    [
      "a service inside $or, decided record by record",
      { any: [test("service", "eq", ["CW"]), test("status", "eq", ["x"])] },
      ["GAS", "CW"],
    ],
  ])("%s", (_, where, services) => {
    expect(servicesAsked(eventsSource, where)).toEqual(services);
  });
});
