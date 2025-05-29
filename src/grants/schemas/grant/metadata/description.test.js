import { expect, it } from "vitest";
import { description } from "./description.js";

it("is a string", () => {
  const { error } = description.validate("GET");
  expect(error).toBeUndefined();
});

it("is at least 3 characters long", () => {
  const { error } = description.validate("");
  expect(error.name).toEqual("ValidationError");
});

it("is at most 100 characters long", () => {
  const { error } = description.validate("a".repeat(501));
  expect(error.name).toEqual("ValidationError");
});
