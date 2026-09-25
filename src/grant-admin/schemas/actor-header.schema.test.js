import { describe, expect, it } from "vitest";
import {
  actorHeaderSchema,
  requiredActorHeaderSchema,
} from "./actor-header.schema.js";

describe("actorHeaderSchema", () => {
  it("accepts an operator name", () => {
    expect(
      actorHeaderSchema.validate({ "x-actor": "donatas" }).error,
    ).toBeUndefined();
  });

  it("is optional - an unattributed mutation is still a mutation", () => {
    expect(actorHeaderSchema.validate({}).error).toBeUndefined();
  });

  it("caps the name at 128 characters, as Caseworking does", () => {
    expect(
      actorHeaderSchema.validate({ "x-actor": "x".repeat(128) }).error,
    ).toBeUndefined();
    expect(
      actorHeaderSchema.validate({ "x-actor": "x".repeat(129) }).error.message,
    ).toBe('"x-actor" must be at most 128 characters');
  });

  it("measures an encoded name once decoded", () => {
    const encoded = `UTF-8''${encodeURIComponent("Ł".repeat(128))}`;

    expect(encoded.length).toBeGreaterThan(128);
    expect(
      actorHeaderSchema.validate({ "x-actor": encoded }).error,
    ).toBeUndefined();
    expect(
      actorHeaderSchema.validate({
        "x-actor": `UTF-8''${encodeURIComponent("Ł".repeat(129))}`,
      }).error,
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

describe("requiredActorHeaderSchema", () => {
  it("accepts an operator name", () => {
    expect(
      requiredActorHeaderSchema.validate({ "x-actor": "donatas" }).error,
    ).toBeUndefined();
  });

  it("refuses a request that names nobody", () => {
    expect(requiredActorHeaderSchema.validate({}).error).toBeDefined();
    expect(
      requiredActorHeaderSchema.validate({ "x-actor": "" }).error,
    ).toBeDefined();
    expect(
      requiredActorHeaderSchema.validate({ "x-actor": "  " }).error,
    ).toBeDefined();
  });

  it("caps the name the same way", () => {
    expect(
      requiredActorHeaderSchema.validate({ "x-actor": "x".repeat(129) }).error
        .message,
    ).toBe('"x-actor" must be at most 128 characters');
  });

  it("lets every other header through", () => {
    expect(
      requiredActorHeaderSchema.validate({
        "x-actor": "donatas",
        authorization: "Bearer token",
      }).error,
    ).toBeUndefined();
  });
});
