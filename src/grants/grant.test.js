import { describe, it } from "node:test";
import { assert } from "../common/assert.js";
import { Grant } from "./grant.js";

describe("grant", () => {
  describe("create", () => {
    it("creates a grant with valid properties", () => {
      const startDate = "2021-01-01T00:00:00.000Z";

      const grant = Grant.create({
        code: "test-code",
        metadata: {
          description: "test description",
          startDate,
        },
        actions: [
          {
            name: "action1",
            method: "GET",
            url: "http://example.com",
          },
        ],
        questions: [],
      });

      assert.equal(grant.code, "test-code");

      assert.deepEqual(grant.metadata, {
        description: "test description",
        startDate,
      });

      assert.deepEqual(grant.actions, [
        {
          name: "action1",
          method: "GET",
          url: "http://example.com",
        },
      ]);
    });

    it("throws when properties invalid", () => {
      const props = {
        code: "test-code",
        metadata: {
          description: "",
        },
        actions: [
          {
            name: "action1",
            method: "INVALID",
            url: "invalid-url",
          },
        ],
      };

      assert.throws(() => Grant.create(props), {
        message: '"metadata.description" is not allowed to be empty',
      });
    });
  });

  describe("validateCode", () => {
    it("parses a valid code", () => {
      assert.doesNotThrow(() => Grant.validateCode("test-code"));
    });

    it("throws an error for an invalid code", () => {
      assert.throws(() => Grant.validateCode(""), {
        message: '"GrantCode" is not allowed to be empty',
      });
    });
  });

  describe("validateActionName", () => {
    it("parses a valid action name", () => {
      assert.doesNotThrow(() => {
        Grant.validateActionName("test-action");
      });
    });

    it("throws an error for an invalid action name", () => {
      assert.throws(() => Grant.validateActionName(""), {
        message: '"GrantActionName" is not allowed to be empty',
      });
    });
  });

  describe("validateActionPayload", () => {
    it("parses a valid payload", () => {
      assert.doesNotThrow(() => Grant.validateActionPayload({ key: "value" }));
    });

    it("throws an error for an invalid payload", () => {
      assert.throws(() => Grant.validateActionPayload(null), {
        message: '"GrantActionPayload" must be of type object',
      });
    });
  });
});
