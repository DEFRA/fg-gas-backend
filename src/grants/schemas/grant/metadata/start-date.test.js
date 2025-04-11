import { it, expect } from "vitest";
import { startDate } from "./start-date.js";

it("is an ISO string", () => {
  const { error } = startDate.validate("2100-01-01T00:00:00Z");
  expect(error).toBeUndefined();
});

it("does not allow dates in the past", () => {
  const { error } = startDate.validate("2000-01-01T00:00:00Z");
  expect(error.name).toEqual("ValidationError");
});
