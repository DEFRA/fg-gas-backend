import { stringValidator } from "./stringValidator.js";
import { describe, it } from "node:test";
import { assert } from "../common/assert.js";

describe("stringValidator", () => {
  describe("maxLength validation", () => {
    it("should return error when string exceeds maxLength", () => {
      const result = stringValidator("testField", "abcdefghijklmn", {
        maxLength: 5,
      });
      assert.equal(result.isValid, false);
      assert.equal(
        result.error,
        "testField exceeds the maximum length of 5 characters",
      );
    });
  });
});
