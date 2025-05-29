import { expect, it } from "vitest";
import { startDate } from "./start-date.js";

it("is an ISO string", () => {
  const { error } = startDate.validate("2100-01-01T00:00:00Z");
  expect(error).toBeUndefined();
});
