import { beforeEach, describe, expect, it } from "vitest";
import {
  clearListGroups,
  registerListGroup,
} from "../../../common/list-groups/registry.js";
import { eventListGroups } from "../../../events/lists/event-list-groups.js";
import { checkSearch, splitAddress } from "./split.js";
import { eventViews } from "./test-groups.js";

let gas;

const split = (where) =>
  splitAddress(gas, where).map(({ value, where: own }) => [value, own]);

const reasonOf = (run) => {
  try {
    run();

    return null;
  } catch (error) {
    return error.output.payload.reason;
  }
};

beforeEach(() => {
  clearListGroups();
  eventListGroups().forEach(registerListGroup);
  gas = eventViews().get("gas.events");
});

describe("splitAddress", () => {
  it.each([
    ["no queue", {}, ["outbox", "inbox"]],
    ["one queue", { box: "inbox" }, ["inbox"]],
    ["both queues", { box: ["outbox", "inbox"] }, ["outbox", "inbox"]],
  ])("reads the members %s picks", (_, picked, values) => {
    expect(split({ ...picked, status: "DEAD_LETTER" })).toEqual(
      values.map((value) => [value, { status: "DEAD_LETTER" }]),
    );
  });

  it.each([
    ["one box's", "CreateCase", [["outbox", { eventType: "CreateCase" }]]],
    [
      "both boxes'",
      "AgreementStatusUpdated",
      [
        ["outbox", { eventType: "AgreementStatusUpdated" }],
        ["inbox", { eventType: "AgreementStatusUpdated" }],
      ],
    ],
    ["neither box's", "Nothing", []],
  ])("reads only the boxes that hold %s event", (_, eventType, members) => {
    expect(split({ eventType })).toEqual(members);
  });

  it("asks each box for its own events alone, one as itself", () => {
    expect(split({ eventType: ["Audit", "CaseStatusUpdated"] })).toEqual([
      ["outbox", { eventType: "Audit" }],
      ["inbox", { eventType: "CaseStatusUpdated" }],
    ]);
    expect(
      split({
        box: "inbox",
        eventType: ["Audit", "CaseStatusUpdated", "AgreementStatusUpdated"],
      }),
    ).toEqual([
      ["inbox", { eventType: ["CaseStatusUpdated", "AgreementStatusUpdated"] }],
    ]);
  });

  it("reads nothing for an event outside the picked queue", () => {
    expect(split({ box: "inbox", eventType: "Audit" })).toEqual([]);
  });

  it("passes the open facts to every box as they are", () => {
    expect(split({ "lastError.name": "TypeError", errorKey: "K" })).toEqual([
      ["outbox", { "lastError.name": "TypeError", errorKey: "K" }],
      ["inbox", { "lastError.name": "TypeError", errorKey: "K" }],
    ]);
  });

  it("leaves out a box that doesn't declare a fact asked", () => {
    const [outbox, inbox] = gas.members;
    const facts = new Map(inbox.facts);
    facts.delete("lastError.name");
    gas = { ...gas, members: [outbox, { ...inbox, facts }] };

    expect(split({ "lastError.name": "TypeError" })).toEqual([
      ["outbox", { "lastError.name": "TypeError" }],
    ]);
  });

  it("reads nothing for an error name beside the key of no recorded error", () => {
    expect(
      split({ "lastError.name": "TypeError", errorKey: "No error recorded" }),
    ).toEqual([]);
    expect(
      split({
        box: "outbox",
        status: "DEAD_LETTER",
        "lastError.name": "TypeError",
        errorKey: "No error recorded",
      }),
    ).toEqual([]);
  });

  it("keeps the key of no recorded error asked without an error name", () => {
    expect(
      split({ status: "DEAD_LETTER", errorKey: "No error recorded" }),
    ).toEqual([
      ["outbox", { status: "DEAD_LETTER", errorKey: "No error recorded" }],
      ["inbox", { status: "DEAD_LETTER", errorKey: "No error recorded" }],
    ]);
  });

  it("drops only that key where several are asked beside an error name", () => {
    expect(
      split({
        box: "inbox",
        "lastError.name": "TypeError",
        errorKey: ["No error recorded", "K"],
      }),
    ).toEqual([["inbox", { "lastError.name": "TypeError", errorKey: "K" }]]);
  });
});

describe("checkSearch", () => {
  it.each([undefined, null, "ref:abc", "id:EVT-1", "trace:0af7"])(
    "takes %s",
    (search) => {
      expect(reasonOf(() => checkSearch(gas, search))).toBeNull();
    },
  );

  it.each([
    ["a link kind only the inboxes read by", "config:woodland@1.0.0"],
    ["a kind no box declares", "nokind:abc"],
    ["no kind", "abc"],
    ["a blank value", "ref:   "],
    ["an inherited name", "constructor:x"],
  ])("refuses %s as an unknown kind", (_, search) => {
    expect(reasonOf(() => checkSearch(gas, search))).toBe("UNKNOWN_REF_KIND");
  });
});
