import { describe, expect, it } from "vitest";
import { Grant } from "./grant.js";

describe("Grant", () => {
  it("can create a Grant model", () => {
    const grant = new Grant({
      code: "test-grant",
      metadata: {
        description: "Test Grant Description",
        startDate: "2023-01-01T00:00:00Z",
      },
      actions: [
        { name: "action1", method: "POST", url: "http://example.com/action1" },
        { name: "action2", method: "GET", url: "http://example.com/action2" },
      ],
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "ASSESSMENT",
              statuses: [{ code: "RECEIVED" }],
            },
          ],
          questions: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
          },
        },
      ],
    });

    expect(grant).toEqual({
      code: "test-grant",
      metadata: {
        description: "Test Grant Description",
        startDate: "2023-01-01T00:00:00Z",
      },
      actions: [
        { name: "action1", method: "POST", url: "http://example.com/action1" },
        { name: "action2", method: "GET", url: "http://example.com/action2" },
      ],
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "ASSESSMENT",
              statuses: [{ code: "RECEIVED" }],
            },
          ],
          questions: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
          },
        },
      ],
    });
  });
});
