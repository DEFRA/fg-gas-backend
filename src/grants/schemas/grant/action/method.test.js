import { expect, it } from "vitest";
import { method } from "./method.js";

it("allows GET requests", () => {
  const { error } = method.validate("GET");
  expect(error).toBeUndefined();
});

it("allows POST requests", () => {
  const { error } = method.validate("POST");
  expect(error).toBeUndefined();
});

it("does not allow others", () => {
  const { error } = method.validate("PUT");
  expect(error.name).toEqual("ValidationError");
});
