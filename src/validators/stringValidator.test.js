import { validateString } from "./stringValidator.js";
import { describe, it } from "node:test";
import { assert } from "../common/assert.js";

describe("validateString", () => {
  describe("maxLength validation", () => {
    it("should validate non string maxLength value", () => {
      const result = validateString("Username", 1, {
        maxLength: 10,
      });

      assert.equal(result.isValid, false);
      assert.equal(result.error, "Username must be a string");
    });

    it("should validate empty value", () => {
      const result = validateString("Username", "", {
        maxLength: 10,
      });

      assert.equal(result.isValid, false);
      assert.equal(result.error, "Username cannot be empty");
    });

    it("should validate maximum length", () => {
      const longValue = "thisusernameiswaytoolong";
      const result = validateString("Username", longValue, {
        maxLength: 10,
      });

      assert.equal(result.isValid, false);
      assert.equal(
        result.error,
        "Username exceeds the maximum length of 10 characters",
      );
    });
  });

  describe("minLength validation", () => {
    it("should validate non string minLength value", () => {
      const result = validateString("Username", 1, {
        maxLength: 1,
      });

      assert.equal(result.isValid, false);
      assert.equal(result.error, "Username must be a string");
    });

    it("should validate empty value", () => {
      const result = validateString("Username", "", {
        maxLength: 10,
      });

      assert.equal(result.isValid, false);
      assert.equal(result.error, "Username cannot be empty");
    });

    it("should validate minimum length", () => {
      const value = "abcde";
      const result = validateString("Username", value, {
        minLength: 10,
      });

      assert.equal(result.isValid, false);
      assert.equal(
        result.error,
        "Username shorter than the minimum length of 10 characters",
      );
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
