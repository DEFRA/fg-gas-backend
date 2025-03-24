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

  describe("combined validations", () => {
    it("should check all validations and return first error found", () => {
      const validations = {
        minLength: 3,
        maxLength: 10,
        pattern: "^[A-Za-z]*$",
      };

      let result = validateString("testField", "abcdefghijklmn", validations);
      assert.equal(result.isValid, false);
      assert.equal(
        result.error,
        "testField exceeds the maximum length of 10 characters",
      );

      result = validateString("testField", "ab", validations);
      assert.equal(result.isValid, false);
      assert.equal(
        result.error,
        "testField shorter than the minimum length of 3 characters",
      );

      result = validateString("testField", "abc123", validations);
      assert.equal(result.isValid, false);
      assert.equal(result.error, "testField must be in the format ^[A-Za-z]*$");

      result = validateString("testField", "abcDef", validations);
      assert.equal(result.isValid, true);
    });
  });
});
