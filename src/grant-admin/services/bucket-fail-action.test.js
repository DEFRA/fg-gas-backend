import Joi from "joi";
import { describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { bucketFailAction } from "./bucket-fail-action.js";

vi.mock("../../common/logger.js");

const refusalOf = (schema, value) => {
  const { error } = schema.validate(value, { abortEarly: false });

  try {
    bucketFailAction({}, {}, error);
  } catch (refusal) {
    return refusal;
  }

  return null;
};

describe("bucketFailAction", () => {
  const schema = Joi.object({ ref: Joi.string().max(5) });

  it("refuses INVALID_REQUEST with its fixed message", () => {
    const refusal = refusalOf(schema, { ref: "SECRET-REF", q: "SECRET-TEXT" });

    expect(refusal.output.payload).toEqual({
      statusCode: 400,
      error: "Bad Request",
      message: "The request is not a bucket query",
      reason: "INVALID_REQUEST",
    });
  });

  it("logs paths and rule names, never a value", () => {
    refusalOf(schema, { ref: "SECRET-REF", q: "SECRET-TEXT" });

    expect(logger.warn).toHaveBeenCalledWith(
      "Query bucket request refused: ref:string.max, q:object.unknown",
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("SECRET");
  });
});
