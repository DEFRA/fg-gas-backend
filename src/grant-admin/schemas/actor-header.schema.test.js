import { describe, expect, it } from "vitest";
import { actorHeaderSchema } from "./actor-header.schema.js";

describe("actorHeaderSchema", () => {
  it("accepts an operator name", () => {
    expect(
      actorHeaderSchema.validate({ "x-actor": "donatas" }).error,
    ).toBeUndefined();
  });

  it("is optional - an unattributed mutation is still a mutation", () => {
    expect(actorHeaderSchema.validate({}).error).toBeUndefined();
  });

  // Long enough for a name that arrived percent-encoded: 40 non-Latin-1
  // characters become 240, and refusing those would refuse exactly the
  // operators the encoding exists to serve.
  it("caps the actor at 512 characters, so an audit event can never carry an essay", () => {
    expect(
      actorHeaderSchema.validate({ "x-actor": "x".repeat(512) }).error,
    ).toBeUndefined();
    expect(
      actorHeaderSchema.validate({ "x-actor": "x".repeat(513) }).error,
    ).toBeDefined();
  });

  it("trims, and treats an empty header as absent", () => {
    expect(
      actorHeaderSchema.validate({ "x-actor": " d " }).value["x-actor"],
    ).toBe("d");
    expect(
      actorHeaderSchema.validate({ "x-actor": "" }).value["x-actor"],
    ).toBeUndefined();
  });

  it("lets every other header through - a real request carries many", () => {
    expect(
      actorHeaderSchema.validate({
        authorization: "Bearer token",
        "x-cdp-request-id": "abc",
      }).error,
    ).toBeUndefined();
  });
});
