import Joi from "joi";
import { describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { safeFailAction, safeResponseFailAction } from "./safe-fail-action.js";

vi.mock("../../common/logger.js");

const SECRET = "secret-ref-123";

const anError = () =>
  Joi.object({
    ref: Joi.string().pattern(/^[a-z]+$/),
    nested: Joi.object({ count: Joi.number() }),
  }).validate({ ref: SECRET, nested: { count: SECRET } }, { abortEarly: false })
    .error;

const thrownBy = (failAction) => {
  try {
    failAction({}, {}, anError());
  } catch (error) {
    return error;
  }

  return null;
};

const logged = () =>
  JSON.stringify([...logger.warn.mock.calls, ...logger.error.mock.calls]);

describe("safeFailAction", () => {
  it("answers 400 naming each refused path and type", () => {
    const error = thrownBy(safeFailAction("Search applications"));

    expect(error.output.statusCode).toBe(400);
    expect(error.message).toBe(
      "Invalid request: ref:string.pattern.base, nested.count:number.base",
    );
  });

  it("never logs or answers a refused value", () => {
    const error = thrownBy(safeFailAction("Search applications"));

    expect(JSON.stringify(error.output.payload)).not.toContain(SECRET);
    expect(logged()).not.toContain(SECRET);
    expect(logger.warn).toHaveBeenCalledWith(
      "Search applications request refused: ref:string.pattern.base, nested.count:number.base",
    );
  });
});

describe("safeResponseFailAction", () => {
  it("answers 500 with a fixed message and logs only paths and types", () => {
    const error = thrownBy(safeResponseFailAction("View application"));

    expect(error.output.statusCode).toBe(500);
    expect(error.message).toBe("View application response failed validation");
    expect(logged()).not.toContain(SECRET);
  });
});
