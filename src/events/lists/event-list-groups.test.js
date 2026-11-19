import { describe, expect, it } from "vitest";
import { eventListGroups } from "./event-list-groups.js";

describe("eventListGroups", () => {
  it("picks each service's box as the Queue, Outbox first", () => {
    const [gas, cw] = eventListGroups();

    expect(gas).toMatchObject({
      id: "gas.events",
      path: "events/gas",
      service: "GAS",
      label: "GAS events",
      shortLabel: "Events",
      order: 10,
      time: { label: "Created" },
      pick: { name: "box", param: "queue", label: "Queue" },
      members: [
        { bucket: "gas.outbox", value: "outbox", label: "Outbox" },
        { bucket: "gas.inbox", value: "inbox", label: "Inbox" },
      ],
    });
    expect(cw).toMatchObject({
      id: "cw.events",
      path: "events/cw",
      service: "CW",
      label: "CW events",
      order: 30,
      members: [
        { bucket: "cw.outbox", value: "outbox", label: "Outbox" },
        { bucket: "cw.inbox", value: "inbox", label: "Inbox" },
      ],
    });
  });

  it("puts Unrecognised last among the event types, and rules out no error key beside an error name", () => {
    const [gas] = eventListGroups();

    expect(gas.lastValues).toEqual({ eventType: ["Unrecognised"] });
    expect(gas.ruledOut).toEqual([
      {
        beside: "lastError.name",
        fact: "errorKey",
        value: "No error recorded",
      },
    ]);
  });
});
