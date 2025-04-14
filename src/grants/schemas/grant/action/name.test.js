import { it, expect } from "vitest";
import { name } from "./name.js";

it("allows alphanumerics and hyphens", () => {
  const { error } = name.validate("abc-123");
  expect(error).toBeUndefined();
});

it("does not allow other symbols", () => {
  const { error } = name.validate("abc*^&$$%#(@123");
  expect(error.name).toEqual("ValidationError");
});

it("is longer than 3 characters", () => {
  const { error } = name.validate("ab");
  expect(error.name).toEqual("ValidationError");
});

it("is shorter than 100 characters", () => {
  const { error } = name.validate("a".repeat(101));
  expect(error.name).toEqual("ValidationError");
});
