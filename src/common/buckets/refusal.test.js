import Boom from "@hapi/boom";
import { describe, expect, it } from "vitest";
import { REFUSAL_REASONS, refuse } from "./refusal.js";

describe("refuse", () => {
  it.each([
    ["UNKNOWN_BUCKET", 404, "No such bucket"],
    ["UNKNOWN_FACT", 400, "A filter names a fact this bucket does not declare"],
    [
      "UNKNOWN_REF_KIND",
      400,
      "The search names an identifier kind this bucket does not declare",
    ],
    [
      "UNKNOWN_GROUPING",
      400,
      "A grouping names a fact this bucket does not group by",
    ],
    [
      "UNKNOWN_FIELD",
      400,
      "The search names a field its definition does not declare",
    ],
    [
      "FIELD_NEEDS_LEAD",
      400,
      "A field search needs the one value its fields are declared for",
    ],
    [
      "FIELD_WITH_FILTER",
      400,
      "A field search cannot be combined with another filter or a ref",
    ],
    [
      "INVALID_FIELD_VALUE",
      400,
      "A searched value needs a letter or digit, and at most 200 characters",
    ],
    [
      "FIELD_TOO_SHORT",
      400,
      "A field searched by its start needs at least 3 letters or digits",
    ],
    ["INVALID_CURSOR", 400, "The cursor cannot be read"],
    ["INVALID_RANGE", 400, '"from" must be earlier than or equal to "to"'],
    ["INVALID_REQUEST", 400, "The request is not a bucket query"],
    ["TIMED_OUT", 504, "The read did not finish in time"],
  ])(
    "answers %s as %i with its fixed message",
    (reason, statusCode, message) => {
      const error = refuse(reason);

      expect(Boom.isBoom(error)).toBe(true);
      expect(error.output.payload).toEqual({
        statusCode,
        error: expect.any(String),
        message,
        reason,
      });
    },
  );

  it("lists every reason", () => {
    expect(REFUSAL_REASONS).toEqual([
      "UNKNOWN_BUCKET",
      "UNKNOWN_SUMMARY",
      "UNKNOWN_FACT",
      "UNKNOWN_REF_KIND",
      "UNKNOWN_GROUPING",
      "UNKNOWN_FIELD",
      "FIELD_NEEDS_LEAD",
      "FIELD_WITH_FILTER",
      "INVALID_FIELD_VALUE",
      "FIELD_TOO_SHORT",
      "INVALID_CURSOR",
      "INVALID_RANGE",
      "INVALID_REQUEST",
      "TIMED_OUT",
    ]);
  });
});
