import { describe, expect, it } from "vitest";
import { findEventsQuerySchema } from "./find-events-query.schema.js";

describe("findEventsQuerySchema", () => {
  it("defaults direction to forward when absent", () => {
    const { error, value } = findEventsQuerySchema.validate({});

    expect(error).toBeUndefined();
    expect(value.direction).toEqual("forward");
  });

  it("accepts no status and no service (All)", () => {
    const { error, value } = findEventsQuerySchema.validate({});

    expect(error).toBeUndefined();
    expect(value.status).toBeUndefined();
    expect(value.service).toBeUndefined();
  });

  it("accepts a cursor, a status and a service", () => {
    const { error, value } = findEventsQuerySchema.validate({
      cursor: "abc",
      direction: "backward",
      status: "DEAD_LETTER",
      service: "caseworking",
    });

    expect(error).toBeUndefined();
    expect(value).toEqual({
      cursor: "abc",
      direction: "backward",
      status: "DEAD_LETTER",
      service: "caseworking",
    });
  });

  it("rejects status=BOGUS", () => {
    const { error } = findEventsQuerySchema.validate({ status: "BOGUS" });

    expect(error).toBeDefined();
  });

  it("rejects service=other", () => {
    const { error } = findEventsQuerySchema.validate({ service: "other" });

    expect(error).toBeDefined();
  });

  it("rejects direction=sideways", () => {
    const { error } = findEventsQuerySchema.validate({ direction: "sideways" });

    expect(error).toBeDefined();
  });

  it("rejects an unknown query parameter", () => {
    const { error } = findEventsQuerySchema.validate({ pageSize: "50" });

    expect(error).toBeDefined();
  });
});
