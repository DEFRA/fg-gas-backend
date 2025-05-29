import { expect, it } from "vitest";
import { url } from "./url.js";

it("allows valid URIs", () => {
  const { error } = url.validate("https://example.com");
  expect(error).toBeUndefined();
});

it("does not allow other values", () => {
  const { error } = url.validate("abc");
  expect(error.name).toEqual("ValidationError");
});
