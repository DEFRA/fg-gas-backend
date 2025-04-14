import { it, expect } from "vitest";
import { answers } from "./answers.js";

it("is an object", () => {
  const { error } = answers.validate({});
  expect(error).toBeUndefined();
});

it("allows unknown properties", () => {
  const { error } = answers.validate({
    any: "value",
  });
  expect(error).toBeUndefined();
});
