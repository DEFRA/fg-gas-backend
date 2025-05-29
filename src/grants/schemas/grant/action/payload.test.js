import { expect, it } from "vitest";
import { payload } from "./payload.js";

it("must be an object", () => {
  const { error } = payload.validate({});
  expect(error).toBeUndefined();
});

it("allows unknown properties", () => {
  const { error } = payload.validate({
    any: "value",
  });
  expect(error).toBeUndefined();
});

it("does not allow other values", () => {
  const { error } = payload.validate("abc");
  expect(error.name).toEqual("ValidationError");
});
