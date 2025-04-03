import { describe, it, expect } from "vitest";
import * as Grant from "./grant.js";

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
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });

    expect(grant).toEqual({
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
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });
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

    expect(() => Grant.create(props)).toThrow(
      '"metadata.description" is not allowed to be empty',
    );
  });
});

describe("validateCode", () => {
  it("parses a valid code", () => {
    expect(() => {
      Grant.validateCode("test-code");
    }).not.toThrow();
  });

  it("throws an error for an invalid code", () => {
    expect(() => {
      Grant.validateCode("invalid-code");
    }).not.toThrow();
  });
});

describe("validateActionName", () => {
  it("parses a valid action name", () => {
    expect(() => {
      Grant.validateActionName("test-action");
    }).not.toThrow();
  });

  it("throws an error for an invalid action name", () => {
    expect(() => {
      Grant.validateActionName("");
    }).toThrow('"GrantActionName" is not allowed to be empty');
  });
});

describe("validateActionPayload", () => {
  it("parses a valid payload", () => {
    expect(() => {
      Grant.validateActionPayload({ key: "value" });
    }).not.toThrow();
  });

  it("throws an error for an invalid payload", () => {
    expect(() => {
      Grant.validateActionPayload(null);
    }).toThrow('"GrantActionPayload" must be of type object');
  });
});
