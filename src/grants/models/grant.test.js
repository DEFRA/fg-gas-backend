import { describe, it, expect } from "vitest";
import { createGrant } from "./grant.js";

describe("create", () => {
  it("creates a grant with valid properties", () => {
    const startDate = "2021-01-01T00:00:00.000Z";

    const grant = createGrant({
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
});
