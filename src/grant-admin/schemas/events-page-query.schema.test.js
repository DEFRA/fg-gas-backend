import { describe, expect, it } from "vitest";
import { eventsPageQuerySchema } from "./events-page-query.schema.js";
import { findEventsQuerySchema } from "./find-events-query.schema.js";

const validate = (query) => eventsPageQuerySchema.validate(query);

describe("eventsPageQuerySchema", () => {
  it("is labelled EventsPageQuery", () => {
    expect(eventsPageQuerySchema.describe().flags.label).toBe(
      "EventsPageQuery",
    );
  });

  it("accepts exactly the parameters the list accepts", () => {
    expect(Object.keys(eventsPageQuerySchema.describe().keys).sort()).toEqual(
      Object.keys(findEventsQuerySchema.describe().keys).sort(),
    );
  });

  it("accepts an empty query and defaults direction to forward", () => {
    const { error, value } = validate({});

    expect(error).toBeUndefined();
    expect(value.direction).toBe("forward");
  });

  it("accepts every filter at once", () => {
    expect(
      validate({
        cursor: "eyJ2IjoxfQ",
        direction: "backward",
        status: "DEAD_LETTER",
        service: "gas",
        q: "GLD-9B2",
        error: "No handler found",
        from: "2026-06-16T00:00:00.000Z",
        to: "2026-06-16T23:59:59.999Z",
      }).error,
    ).toBeUndefined();
  });

  // `status` and `error` filter the list; the use case keeps them away from
  // the sections that do not accept them.
  it.each(["status", "error"])("accepts a %s the sections refused", (key) => {
    expect(
      validate({ [key]: key === "status" ? "FAILED" : "boom" }).error,
    ).toBeUndefined();
  });

  it.each([
    ["a status outside the six", { status: "BOGUS" }],
    ["a service outside the two", { service: "other" }],
    ["a direction outside the two", { direction: "sideways" }],
    ["a page size the list never had", { pageSize: 20 }],
    ["a limit the list never had", { limit: 20 }],
    ["the kind filter that no longer exists", { kind: "audit" }],
    ["a q over 200 characters", { q: "a".repeat(201) }],
    ["an audit mode outside the two", { audit: "maybe" }],
    ["an empty audit mode", { audit: "" }],
    [
      "a reversed range",
      { from: "2026-06-17T00:00:00.000Z", to: "2026-06-16T00:00:00.000Z" },
    ],
  ])("rejects %s", (_name, query) => {
    expect(validate(query).error).toBeDefined();
  });

  it("trims q and treats a whitespace-only q as absent", () => {
    expect(validate({ q: "  evt-1  " }).value.q).toBe("evt-1");
    expect(validate({ q: "   " }).value.q).toBeUndefined();
  });
});

describe("eventsPageQuerySchema audit", () => {
  it("defaults to excluding audit records", () => {
    expect(validate({}).value.audit).toBe("exclude");
  });

  it.each(["include", "exclude"])("accepts audit=%s", (audit) => {
    const { error, value } = validate({ audit });

    expect(error).toBeUndefined();
    expect(value.audit).toBe(audit);
  });

  // Validated exactly as `status` and `service` are, so a typo is a 400 rather
  // than a silently different population.
  it("rejects anything else, as any other bad enum is rejected", () => {
    expect(validate({ audit: "all" }).error).toBeDefined();
    expect(validate({ audit: true }).error).toBeDefined();
  });
});
