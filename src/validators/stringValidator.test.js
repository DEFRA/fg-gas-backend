import { validateString } from "./stringValidator.js";
import { describe, it } from "node:test";
import { assert } from "../common/assert.js";

describe("validateString", () => {
  describe("maxLength validation", () => {
    it("should return error when string exceeds maxLength", () => {
      const result = validateString("testField", "abcdefghijklmn", {
        maxLength: 5,
      });
      assert.equal(result.isValid, false);
      assert.equal(
        result.error,
        "testField exceeds the maximum length of 5 characters",
      );
    });
    it("should pass when string is equal to maxLength", () => {
      const result = validateString("testField", "abcde", { maxLength: 5 });
      assert.equal(result.isValid, true);
    });

    it("should pass when string is less than maxLength", () => {
      const result = validateString("testField", "abc", { maxLength: 5 });
      assert.equal(result.isValid, true);
    });
  });

  describe("minLength validation", () => {
    it("should return error when string is less than minLength", () => {
      const result = validateString("testField", "abc", {
        minLength: 5,
      });
      assert.equal(result.isValid, false);
      assert.equal(
        result.error,
        "testField shorter than the minimum length of 5 characters",
      );
    });
    it("should pass when string is equal to minLength", () => {
      const result = validateString("testField", "abcde", { minLength: 5 });
      assert.equal(result.isValid, true);
    });

    it("should pass when string is greater than maxLength", () => {
      const result = validateString("testField", "abcdef", { minLength: 5 });
      assert.equal(result.isValid, true);
    });
  });
});
