import { describe, expect, it } from "vitest";
import { breakdownEventsResponseSchema } from "./breakdown-events-response.schema.js";

const aGroup = (overrides = {}) => ({
  error: "No handler found for event type",
  type: "case.status.updated",
  count: 7,
  firstAt: "2026-06-16T10:00:00.000Z",
  lastAt: "2026-06-16T11:00:00.000Z",
  ...overrides,
});

const payload = (overrides = {}) => ({
  groups: [aGroup()],
  sourceErrors: [],
  ...overrides,
});

const validate = (body) => breakdownEventsResponseSchema.validate(body);

describe("breakdownEventsResponseSchema", () => {
  it("accepts a group", () => {
    expect(validate(payload()).error).toBeUndefined();
  });

  it("accepts no groups at all", () => {
    expect(validate(payload({ groups: [] })).error).toBeUndefined();
  });

  it("accepts a null error - a row can die before any error is recorded", () => {
    expect(
      validate(payload({ groups: [aGroup({ error: null })] })).error,
    ).toBeUndefined();
  });

  // Null is the honest answer for the group of rows that carry no stored type
  // at all - an audit record is not a CloudEvent and has none.
  it("accepts a null type", () => {
    expect(
      validate(payload({ groups: [aGroup({ type: null })] })).error,
    ).toBeUndefined();
  });

  it("still requires the key itself, so a mapping gap fails a test", () => {
    const { type, ...rest } = aGroup();

    expect(validate(payload({ groups: [rest] })).error).toBeDefined();
  });

  it("accepts an audit row's display type", () => {
    expect(
      validate(
        payload({ groups: [aGroup({ type: "audit · GRANT.REPLACE_GRANT" })] }),
      ).error,
    ).toBeUndefined();
  });

  it("accepts null timestamps", () => {
    expect(
      validate(payload({ groups: [aGroup({ firstAt: null, lastAt: null })] }))
        .error,
    ).toBeUndefined();
  });

  it("rejects a zero or negative count - a group only exists because rows do", () => {
    expect(
      validate(payload({ groups: [aGroup({ count: 0 })] })).error,
    ).toBeDefined();
  });

  it("carries source errors in the same shape the list uses", () => {
    expect(
      validate(
        payload({
          sourceErrors: [
            { service: "caseworking", box: "inbox", message: "timeout" },
          ],
        }),
      ).error,
    ).toBeUndefined();
  });

  it("requires sourceErrors, so a partial answer always announces itself", () => {
    const { sourceErrors, ...body } = payload();

    expect(validate(body).error).toBeDefined();
  });
});
