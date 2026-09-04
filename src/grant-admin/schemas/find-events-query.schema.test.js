import { describe, expect, it } from "vitest";
import {
  EVENT_STATUSES,
  actorHeaderSchema,
  findEventsQuerySchema,
} from "./find-events-query.schema.js";

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

describe("findEventsQuerySchema q", () => {
  const validate = (query) => findEventsQuerySchema.validate(query);

  it("accepts a q and trims it", () => {
    const { error, value } = validate({ q: "  GLD-9B2-BWS  " });

    expect(error).toBeUndefined();
    expect(value.q).toEqual("GLD-9B2-BWS");
  });

  it("treats an empty q as absent", () => {
    const { error, value } = validate({ q: "" });

    expect(error).toBeUndefined();
    expect(value.q).toBeUndefined();
  });

  it("treats a whitespace-only q as absent", () => {
    const { error, value } = validate({ q: "   " });

    expect(error).toBeUndefined();
    expect(value.q).toBeUndefined();
  });

  it("accepts a q of exactly 200 characters", () => {
    expect(validate({ q: "a".repeat(200) }).error).toBeUndefined();
  });

  it("rejects a q longer than 200 characters", () => {
    expect(validate({ q: "a".repeat(201) }).error).toBeDefined();
  });

  // The TYPE filter is gone. `kind` is not an accepted parameter any more, so
  // it is rejected the way any unknown parameter is - a 400, not a silent
  // ignore. Audit rows are still LABELLED as audit in the response.
  it("rejects kind as an unknown parameter", () => {
    expect(validate({ kind: "audit" }).error).toBeDefined();
    expect(validate({ kind: "domain" }).error).toBeDefined();
    expect(validate({ kind: "" }).error).toBeDefined();
  });

  it("accepts q alongside status and service", () => {
    const { error, value } = validate({
      status: "FAILED",
      service: "gas",
      q: "evt-1",
    });

    expect(error).toBeUndefined();
    expect(value).toMatchObject({ q: "evt-1" });
  });
});

describe("findEventsQuerySchema from and to", () => {
  const FROM = "2026-06-16T00:00:00.000Z";
  const TO = "2026-06-16T23:59:59.999Z";

  const validate = (query) => findEventsQuerySchema.validate(query);

  it("accepts both bounds as ISO strings and keeps them as strings", () => {
    const { error, value } = validate({ from: FROM, to: TO });

    expect(error).toBeUndefined();
    expect(value.from).toBe(FROM);
    expect(value.to).toBe(TO);
    expect(typeof value.to).toBe("string");
  });

  it("accepts either bound on its own", () => {
    expect(validate({ from: FROM }).error).toBeUndefined();
    expect(validate({ to: TO }).error).toBeUndefined();
  });

  it("is optional - no bound at all is still valid", () => {
    expect(validate({}).error).toBeUndefined();
  });

  it("rejects a bound that is not an ISO date", () => {
    expect(validate({ from: "yesterday" }).error).toBeDefined();
    expect(validate({ to: "16/06/2026" }).error).toBeDefined();
  });

  it("rejects from after to", () => {
    expect(validate({ from: TO, to: FROM }).error.message).toBe(
      '"from" must be earlier than or equal to "to"',
    );
  });

  it("accepts from equal to to", () => {
    expect(validate({ from: FROM, to: FROM }).error).toBeUndefined();
  });

  it("compares the bounds as instants, not as strings", () => {
    expect(
      validate({
        from: "2026-06-16T00:00:00.000Z",
        to: "2026-06-16T01:00:00.000+02:00",
      }).error,
    ).toBeDefined();
  });
});

describe("findEventsQuerySchema PARKED", () => {
  it("accepts PARKED as a status, so an operator can list what they have parked", () => {
    expect(
      findEventsQuerySchema.validate({ status: "PARKED" }).error,
    ).toBeUndefined();
  });

  it("has PARKED in the enum GAS is the single authority for", () => {
    expect(EVENT_STATUSES).toContain("PARKED");
  });
});

describe("findEventsQuerySchema error", () => {
  it("accepts an exact stored error message", () => {
    expect(
      findEventsQuerySchema.validate({ error: "No handler found" }).error,
    ).toBeUndefined();
  });

  it("trims, and treats whitespace-only as absent rather than as a 400", () => {
    expect(
      findEventsQuerySchema.validate({ error: "  boom  " }).value.error,
    ).toBe("boom");
    expect(
      findEventsQuerySchema.validate({ error: "" }).value.error,
    ).toBeUndefined();
  });

  it("caps the message at 512 characters", () => {
    expect(
      findEventsQuerySchema.validate({ error: "x".repeat(512) }).error,
    ).toBeUndefined();
    expect(
      findEventsQuerySchema.validate({ error: "x".repeat(513) }).error,
    ).toBeDefined();
  });

  it("combines with the other filters rather than replacing them", () => {
    const { error, value } = findEventsQuerySchema.validate({
      status: "DEAD_LETTER",
      service: "gas",
      q: "GLD-9B2",
      error: "boom",
    });

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      status: "DEAD_LETTER",
      service: "gas",
      q: "GLD-9B2",
      error: "boom",
    });
  });
});

describe("actorHeaderSchema", () => {
  it("accepts an operator name", () => {
    expect(
      actorHeaderSchema.validate({ "x-actor": "donatas" }).error,
    ).toBeUndefined();
  });

  it("is optional - an unattributed mutation is still a mutation", () => {
    expect(actorHeaderSchema.validate({}).error).toBeUndefined();
  });

  it("caps the actor at 128 characters, so an audit event can never carry an essay", () => {
    expect(
      actorHeaderSchema.validate({ "x-actor": "x".repeat(128) }).error,
    ).toBeUndefined();
    expect(
      actorHeaderSchema.validate({ "x-actor": "x".repeat(129) }).error,
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
