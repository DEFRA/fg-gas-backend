import { beforeEach, describe, expect, it, vi } from "vitest";

let eventTypes;

const declare = (overrides) =>
  eventTypes.defineEventType({
    name: "case.create",
    sentAs: "cloud.defra.test.fg-gas-backend.case.create",
    boxes: [eventTypes.OUTBOX],
    ...overrides,
  });

beforeEach(async () => {
  vi.resetModules();
  eventTypes = await import("./event-types.js");
});

describe("defineEventType", () => {
  it("returns the frozen declaration with its defaults", () => {
    const caseCreate = declare();

    expect(caseCreate).toMatchObject({
      name: "case.create",
      sentAs: "cloud.defra.test.fg-gas-backend.case.create",
      boxes: ["outbox"],
      hiddenByDefault: false,
    });
    expect(caseCreate.refs({}, {})).toEqual([]);
    expect(Object.isFrozen(caseCreate)).toBe(true);
    expect(Object.isFrozen(caseCreate.boxes)).toBe(true);
  });

  it("throws when sentAs is declared twice under another name", () => {
    declare();

    expect(() => declare({ name: "case.open" })).toThrow(
      'Event type "cloud.defra.test.fg-gas-backend.case.create" is already declared as "case.create"',
    );
  });

  it("lets several types travel with no type of their own", () => {
    declare({ name: "reporting.one", sentAs: undefined });

    expect(() =>
      declare({ name: "reporting.two", sentAs: undefined }),
    ).not.toThrow();
  });
});

describe("findEventType", () => {
  it("finds a declaration by the exact envelope type", () => {
    const caseCreate = declare();

    expect(
      eventTypes.findEventType({
        type: "cloud.defra.test.fg-gas-backend.case.create",
      }),
    ).toBe(caseCreate);
  });

  it("then asks each declaration whether it recognises the envelope", () => {
    declare();
    const reporting = declare({
      name: "reporting.created",
      sentAs: undefined,
      recognise: ({ eventData }) => eventData?.eventType === "CREATED",
    });

    expect(
      eventTypes.findEventType({ eventData: { eventType: "CREATED" } }),
    ).toBe(reporting);
  });

  it("answers null when nobody declared it", () => {
    declare();

    expect(
      eventTypes.findEventType({
        type: "cloud.defra.other.fg-gas-backend.case.create",
      }),
    ).toBeNull();
    expect(eventTypes.findEventType({})).toBeNull();
  });
});

describe("findEventTypeInAnyEnvironment", () => {
  it("finds a declaration sent from another environment", () => {
    const caseCreate = declare();

    expect(
      eventTypes.findEventTypeInAnyEnvironment({
        type: "cloud.defra.prod.fg-gas-backend.case.create",
      }),
    ).toBe(caseCreate);
  });

  it("prefers the exact type", () => {
    const here = declare();
    declare({
      name: "case.create.elsewhere",
      sentAs: "cloud.defra.dev.fg-gas-backend.case.create.elsewhere",
    });

    expect(
      eventTypes.findEventTypeInAnyEnvironment({
        type: "cloud.defra.test.fg-gas-backend.case.create",
      }),
    ).toBe(here);
  });

  it("does not match another service or another name", () => {
    declare();

    expect(
      eventTypes.findEventTypeInAnyEnvironment({
        type: "cloud.defra.prod.fg-cw-backend.case.create",
      }),
    ).toBeNull();
    expect(
      eventTypes.findEventTypeInAnyEnvironment({
        type: "cloud.defra.prod.fg-gas-backend.case.created",
      }),
    ).toBeNull();
    expect(eventTypes.findEventTypeInAnyEnvironment({})).toBeNull();
  });

  it("matches a type with no environment segment only exactly", () => {
    const configVersion = declare({
      name: "config-version.updated",
      sentAs: "config-version.updated",
      boxes: [eventTypes.INBOX],
    });

    expect(
      eventTypes.findEventTypeInAnyEnvironment({
        type: "config-version.updated",
      }),
    ).toBe(configVersion);
  });
});

describe("eventTypeNames", () => {
  it("lists the names declared for the box, sorted, then unrecognised", () => {
    declare({ name: "case.update.status", sentAs: "update" });
    declare({ name: "application.created", sentAs: "created" });
    declare({
      name: "agreement.status.updated",
      sentAs: "status",
      boxes: [eventTypes.OUTBOX, eventTypes.INBOX],
    });
    declare({
      name: "case.status.updated",
      sentAs: "case-status",
      boxes: [eventTypes.INBOX],
    });

    expect(eventTypes.eventTypeNames(eventTypes.OUTBOX)).toEqual([
      "agreement.status.updated",
      "application.created",
      "Audit",
      "case.update.status",
      "Unrecognised",
    ]);
    expect(eventTypes.eventTypeNames(eventTypes.INBOX)).toEqual([
      "agreement.status.updated",
      "case.status.updated",
      "Unrecognised",
    ]);
  });

  it("lists only the built-in types when nothing is declared", () => {
    expect(eventTypes.eventTypeNames(eventTypes.OUTBOX)).toEqual([
      "Audit",
      "Unrecognised",
    ]);
    expect(eventTypes.eventTypeNames(eventTypes.INBOX)).toEqual([
      "Unrecognised",
    ]);
  });
});

describe("eventTypeValues", () => {
  it("lists the box's types as values, marking those hidden by default", () => {
    declare({ name: "case.update.status", sentAs: "update" });
    declare({ name: "internal.tick", sentAs: "tick", hiddenByDefault: true });

    expect(eventTypes.eventTypeValues(eventTypes.OUTBOX)).toEqual([
      { value: "Audit", label: "Audit", hidden: true },
      { value: "case.update.status", label: "case.update.status" },
      { value: "internal.tick", label: "internal.tick", hidden: true },
      { value: "Unrecognised", label: "Unrecognised" },
    ]);
  });

  it("hides nothing in a box where no type is marked", () => {
    declare({ name: "case.create", sentAs: "create", boxes: ["inbox"] });

    expect(eventTypes.eventTypeValues(eventTypes.INBOX)).toEqual([
      { value: "case.create", label: "case.create" },
      { value: "Unrecognised", label: "Unrecognised" },
    ]);
  });
});

describe("the audit type", () => {
  it("is declared for the outbox, hidden by default, and matches no envelope", () => {
    expect(eventTypes.audit).toMatchObject({
      name: "Audit",
      boxes: ["outbox"],
      hiddenByDefault: true,
    });
    expect(eventTypes.findEventType({ type: undefined })).toBeNull();
    expect(eventTypes.findEventTypeInAnyEnvironment({})).toBeNull();
  });
});
