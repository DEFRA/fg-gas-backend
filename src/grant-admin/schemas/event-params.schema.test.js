import { describe, expect, it } from "vitest";
import { EVENT_BOXES, eventParamsSchema } from "./event-params.schema.js";

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const validate = (overrides = {}) =>
  eventParamsSchema.validate({
    service: "gas",
    box: "inbox",
    id: ID,
    ...overrides,
  });

describe("eventParamsSchema", () => {
  it("names both boxes", () => {
    expect(EVENT_BOXES).toEqual(["inbox", "outbox"]);
  });

  it("accepts a gas inbox row", () => {
    expect(validate().error).toBeUndefined();
  });

  it("accepts a caseworking outbox row", () => {
    expect(
      validate({ service: "caseworking", box: "outbox" }).error,
    ).toBeUndefined();
  });

  it("accepts uppercase hex", () => {
    expect(validate({ id: ID.toUpperCase() }).error).toBeUndefined();
  });

  it("rejects an unknown service", () => {
    expect(validate({ service: "payments" }).error).toBeDefined();
  });

  it("rejects an unknown box", () => {
    expect(validate({ box: "dlq" }).error).toBeDefined();
  });

  it("rejects a short id", () => {
    expect(validate({ id: "665f1c2e" }).error).toBeDefined();
  });

  it("rejects non-hex characters", () => {
    expect(validate({ id: "665f1c2e9a1b2c3d4e5f6a7z" }).error).toBeDefined();
  });

  it("rejects a missing id", () => {
    expect(
      eventParamsSchema.validate({ service: "gas", box: "inbox" }).error,
    ).toBeDefined();
  });

  it("rejects an unknown param", () => {
    expect(validate({ cursor: "abc" }).error).toBeDefined();
  });
});
