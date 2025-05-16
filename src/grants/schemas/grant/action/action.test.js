import { expect, it } from "vitest";
import { action } from "./action.js";

it("allows valid actions", () => {
  const { error } = action.validate({
    name: "action-name",
    method: "GET",
    url: "https://example.com",
  });
  expect(error).toBeUndefined();
});

it("requires a name", () => {
  const { error } = action.validate({
    method: "GET",
    url: "https://example.com",
  });
  expect(error.name).toEqual("ValidationError");
});

it("requires a method", () => {
  const { error } = action.validate({
    name: "action-name",
    url: "https://example.com",
  });
  expect(error.name).toEqual("ValidationError");
});

it("requires a url", () => {
  const { error } = action.validate({
    name: "action-name",
    method: "GET",
  });
  expect(error.name).toEqual("ValidationError");
});
