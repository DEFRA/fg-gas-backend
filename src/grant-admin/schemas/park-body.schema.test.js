import { describe, expect, it } from "vitest";
import { parkBodySchema } from "./park-body.schema.js";

const validate = (body) => parkBodySchema.validate(body);

describe("parkBodySchema", () => {
  it("accepts a reason", () => {
    expect(validate({ reason: "poison payload" }).error).toBeUndefined();
  });

  it("requires one - parking is a recorded act, not a silent one", () => {
    expect(validate({}).error).toBeDefined();
  });

  it("rejects an empty or whitespace-only reason", () => {
    expect(validate({ reason: "" }).error).toBeDefined();
    expect(validate({ reason: "   " }).error).toBeDefined();
  });

  it("trims, so a pasted reason is stored without its whitespace", () => {
    expect(validate({ reason: "  poison  " }).value.reason).toBe("poison");
  });

  it("caps the reason at 512 characters - it lives on the document forever", () => {
    expect(validate({ reason: "x".repeat(512) }).error).toBeUndefined();
    expect(validate({ reason: "x".repeat(513) }).error).toBeDefined();
  });

  it("rejects anything else in the body", () => {
    expect(
      validate({ reason: "poison", status: "COMPLETED" }).error,
    ).toBeDefined();
  });
});
