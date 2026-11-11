import { describe, expect, test } from "vitest";
import {
  fromUrlQuery,
  repeatedKeys,
  unknownKeys,
  unknownValues,
} from "./list-address.js";

const outboxBucket = {
  id: "gas.outbox",
  path: "events/gas/outbox",
  facts: [
    {
      name: "status",
      param: "status",
      label: "Status",
      values: [
        { value: "PUBLISHED", label: "Queued", tone: "neutral" },
        { value: "DEAD_LETTER", label: "Dead letter", tone: "error" },
      ],
      within: null,
    },
    {
      name: "eventType",
      param: "event",
      label: "Event",
      values: [
        { value: "UpdateCaseStatus", label: "UpdateCaseStatus" },
        { value: "Unrecognised", label: "Unrecognised" },
      ],
      within: null,
    },
    {
      name: "grantCode",
      param: "grant",
      label: "Grant",
      values: null,
      within: null,
    },
    {
      name: "lastError.name",
      param: "error",
      label: "Error name",
      values: null,
      within: null,
    },
  ],
};

const auditedOutbox = {
  ...outboxBucket,
  facts: outboxBucket.facts.map((fact) =>
    fact.name === "eventType"
      ? {
          ...fact,
          values: [{ value: "Audit", label: "Audit" }, ...fact.values],
        }
      : fact,
  ),
};

describe("fromUrlQuery", () => {
  test("reads each key back to its fact: a fact with offered values as a list, any other as one value", () => {
    expect(
      fromUrlQuery(auditedOutbox, {
        event: "Audit",
        status: ["DEAD_LETTER", "FAILED", "DEAD_LETTER", ""],
        error: "TypeError",
        range: "24h",
      }),
    ).toEqual({
      eventType: ["Audit"],
      status: ["DEAD_LETTER", "FAILED"],
      "lastError.name": "TypeError",
      range: "24h",
    });
  });

  test("reads a fact that takes one value from the first, when the address repeats it", () => {
    expect(fromUrlQuery(auditedOutbox, { error: ["A", "B"] })).toEqual({
      "lastError.name": "A",
    });
  });

  test("reads no key it does not declare", () => {
    expect(
      fromUrlQuery(auditedOutbox, { eventType: "Audit", audit: "on" }),
    ).toEqual({});
  });
});

describe("unknownKeys", () => {
  test("names every key the list does not declare, the old audit switch’s among them", () => {
    expect(
      unknownKeys(auditedOutbox, {
        status: ["FAILED", "DEAD_LETTER"],
        eventType: "Audit",
        show: "eventType",
        audit: "on",
        from: "2026-10-08T12:00:00.000Z",
        colour: "x",
      }),
    ).toEqual(["eventType", "show", "audit", "colour"]);
  });
});

describe("repeatedKeys", () => {
  test("names a key given twice for a fact that takes one value, not one whose values are offered", () => {
    expect(
      repeatedKeys(auditedOutbox, {
        status: ["FAILED", "DEAD_LETTER"],
        error: ["A", "B"],
        event: "Audit",
      }),
    ).toEqual(["error"]);
  });
});

describe("unknownValues", () => {
  test("names a key whose value its fact doesn’t offer", () => {
    expect(
      unknownValues(auditedOutbox, {
        status: ["FAILED", "BOGUS"],
        event: "Audit",
        error: "anything",
      }),
    ).toEqual(["status"]);
  });

  test("leaves a fact another sits within open, as it names a code that may have no rows yet", () => {
    const applications = {
      facts: [
        {
          name: "code",
          param: "grant",
          values: [{ value: "example-grant", label: "example-grant" }],
          within: null,
        },
        {
          name: "currentConfigVersion",
          param: "version",
          values: null,
          within: "code",
        },
      ],
    };

    expect(unknownValues(applications, { grant: "other-grant" })).toEqual([]);
  });
});
