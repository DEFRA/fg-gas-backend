import { expect, it } from "vitest";
import { code } from "./code.js";

it("allows alphanumerics and hyphens", () => {
  const { error } = code.validate("abc-123");
  expect(error).toBeUndefined();
});

it("does not allow other symbols", () => {
  const { error } = code.validate("abc*^&$$%#(@123");
  expect(error.name).toEqual("ValidationError");
});
