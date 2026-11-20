import { beforeEach, describe, expect, it, vi } from "vitest";
import { catalogueEntrySchema } from "../../../common/buckets/schema.js";
import { logger } from "../../../common/logger.js";
import {
  clearListGroups,
  registerListGroup,
} from "../../../common/list-groups/registry.js";
import { eventListGroups } from "../../../events/lists/event-list-groups.js";
import {
  composeListGroups,
  cwGroupPaths,
  listOfGroupMember,
} from "./catalogue.js";
import {
  CW_TYPES,
  GAS_TYPES,
  anEventEntry,
  eventEntries,
} from "./test-groups.js";

vi.mock("../../../common/logger.js");

const OTHER = { id: "gas.grants", path: "grants", order: 50 };

const compose = (buckets, cwRead = true) =>
  composeListGroups(buckets, { cwRead });

// GAS's boxes alone, Caseworking's part unread.
const composeGas = (buckets) => compose(buckets, false);

const entryOf = ({ buckets }, id) => buckets.find((entry) => entry.id === id);

const factOf = (entry, name) => entry.facts.find((fact) => fact.name === name);

const warnings = () => logger.warn.mock.calls.map(([message]) => message);
const errors = () => logger.error.mock.calls.map(([message]) => message);

const withFact = (entry, name, change) => ({
  ...entry,
  facts: entry.facts.map((fact) =>
    fact.name === name ? { ...fact, ...change } : fact,
  ),
});

describe("composeListGroups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearListGroups();
    eventListGroups().forEach(registerListGroup);
  });

  it("composes each service's events from its own boxes, with no warning", () => {
    const composed = compose([...eventEntries(), OTHER]);

    expect(composed.buckets.map(({ id }) => id)).toEqual([
      "gas.events",
      "cw.events",
      "gas.grants",
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("builds an entry the catalogue's own schema takes, with the queue picked first", () => {
    const gas = entryOf(compose(eventEntries()), "gas.events");

    expect(catalogueEntrySchema.validate(gas).error).toBeUndefined();
    expect(gas).toMatchObject({
      path: "events/gas",
      label: "GAS events",
      shortLabel: "Events",
      service: "GAS",
      order: 10,
      time: { label: "Created" },
      indexes: [],
      groupings: [],
      audited: false,
      timeline: false,
      page: null,
      tab: null,
      title: { label: "Event", format: "eventType" },
      columns: [
        { key: "box", label: "Queue", format: "label", fact: "box" },
        { key: "status", label: "Status", format: "badge", fact: "status" },
      ],
    });
    expect(gas.facts.map(({ name, param }) => [name, param])).toEqual([
      ["box", "queue"],
      ["status", "status"],
      ["eventType", "event"],
      ["lastError.name", "errorname"],
      ["errorKey", "error"],
    ]);
    expect(factOf(gas, "box")).toEqual({
      name: "box",
      param: "queue",
      label: "Queue",
      values: [
        { value: "outbox", label: "Outbox" },
        { value: "inbox", label: "Inbox" },
      ],
      toggle: null,
      within: null,
    });
  });

  it("offers both boxes' event types by name, Unrecognised last", () => {
    const gas = entryOf(compose(eventEntries()), "gas.events");

    expect(factOf(gas, "eventType").values.map(({ value }) => value)).toEqual([
      "AgreementStatusUpdated",
      "Audit",
      "CaseStatusUpdated",
      "CreateCase",
      "Unrecognised",
    ]);
  });

  it("keeps the first box's order for a fact the group doesn't sort, then the rest's values", () => {
    const outbox = withFact(anEventEntry("gas.outbox", []), "status", {
      values: [
        { value: "B", label: "Bee", tone: "info" },
        { value: "A", label: "Ay" },
      ],
    });
    const inbox = withFact(anEventEntry("gas.inbox", []), "status", {
      values: [
        { value: "C", label: "See" },
        { value: "A", label: "Ay", tone: "error", hint: "Hint" },
      ],
    });

    const gas = entryOf(composeGas([outbox, inbox]), "gas.events");

    expect(factOf(gas, "status").values).toEqual([
      { value: "B", label: "Bee", tone: "info" },
      { value: "A", label: "Ay", tone: "error", hint: "Hint" },
      { value: "C", label: "See" },
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("leaves a fact open when any box leaves it open", () => {
    const inbox = withFact(anEventEntry("gas.inbox", []), "status", {
      values: null,
    });

    const gas = entryOf(
      composeGas([anEventEntry("gas.outbox", []), inbox]),
      "gas.events",
    );

    expect(factOf(gas, "status").values).toBeNull();
  });

  it("takes a fact's label from the first box, and logs that they differ", () => {
    const inbox = withFact(anEventEntry("gas.inbox", []), "status", {
      label: "State",
    });

    const gas = entryOf(
      composeGas([anEventEntry("gas.outbox", []), inbox]),
      "gas.events",
    );

    expect(factOf(gas, "status").label).toBe("Status");
    expect(warnings()).toEqual([
      "List group gas.events: members describe status differently",
    ]);
  });

  it("keeps a fact only one box declares, and the kinds of search every box offers", () => {
    const outbox = {
      ...anEventEntry("gas.outbox", []),
      facts: [
        ...anEventEntry("gas.outbox", []).facts,
        {
          name: "target",
          param: "target",
          label: "Target",
          values: null,
          within: null,
        },
      ],
      refs: [...anEventEntry("gas.outbox", []).refs, { kind: "x", label: "X" }],
    };

    const composed = composeGas([outbox, anEventEntry("gas.inbox", [])]);
    const gas = entryOf(composed, "gas.events");

    expect(factOf(gas, "target")).toMatchObject({ values: null });
    expect(gas.refs.map(({ kind }) => kind)).toEqual(["ref", "trace", "id"]);
    expect(composed.views.get("gas.events").refs).toEqual({
      ref: "Reference",
      trace: "Trace ID",
      id: "Event ID",
    });
  });

  it("carries the boxes' summaries once each, so a summary's none value reads as words", () => {
    const gas = entryOf(compose(eventEntries()), "gas.events");

    expect(gas.summaries).toEqual([
      expect.objectContaining({ id: "errors", none: "No error recorded" }),
    ]);
  });

  it("keeps each box's own values server-side, and none on the wire", () => {
    const composed = compose(eventEntries());
    const view = composed.views.get("gas.events");

    expect(view.members.map(({ bucket, value }) => [bucket, value])).toEqual([
      ["gas.outbox", "outbox"],
      ["gas.inbox", "inbox"],
    ]);
    expect([...view.members[1].facts.get("eventType")]).toEqual(
      GAS_TYPES.inbox,
    );
    expect(view.members[0].facts.get("errorKey")).toBeNull();
    expect(JSON.stringify(composed.buckets)).not.toContain("members");
  });

  it.each([
    [
      "one name under two URL keys",
      (entry) => withFact(entry, "status", { param: "state" }),
      "status has two URL keys",
    ],
    [
      "one URL key for two names",
      (entry) => ({
        ...entry,
        facts: [
          ...entry.facts,
          { name: "state", param: "status", label: "State", values: null },
        ],
      }),
      "status names both status and state",
    ],
  ])(
    "builds no group on %s, lists neither box, and logs why",
    (_, change, problem) => {
      const composed = composeGas([
        anEventEntry("gas.outbox", GAS_TYPES.outbox),
        change(anEventEntry("gas.inbox", GAS_TYPES.inbox)),
      ]);

      expect(composed.buckets).toEqual([]);
      expect(composed.views.size).toBe(0);
      expect(errors()).toEqual([`List group gas.events not built: ${problem}`]);
    },
  );

  it("builds no group when a box is missing, and lists the other nowhere", () => {
    const composed = compose([
      anEventEntry("gas.outbox", GAS_TYPES.outbox),
      anEventEntry("cw.outbox", CW_TYPES.outbox),
      anEventEntry("cw.inbox", CW_TYPES.inbox),
    ]);

    expect(composed.buckets.map(({ id }) => id)).toEqual(["cw.events"]);
    expect(errors()).toEqual([
      "List group gas.events not built: gas.inbox missing",
    ]);
  });

  it("logs Caseworking's missing boxes only once its part was read", () => {
    const gasOnly = eventEntries().filter(({ id }) => id.startsWith("gas."));

    expect(compose(gasOnly, false).buckets.map(({ id }) => id)).toEqual([
      "gas.events",
    ]);
    expect(logger.error).not.toHaveBeenCalled();

    compose(gasOnly, true);

    expect(errors()).toEqual([
      "List group cw.events not built: cw.outbox missing",
    ]);
  });

  it("sorts the catalogue by order once the groups are in it", () => {
    const composed = compose([
      { id: "gas.first", order: 1 },
      ...eventEntries(),
      { id: "gas.between", order: 20 },
    ]);

    expect(composed.buckets.map(({ id }) => id)).toEqual([
      "gas.first",
      "gas.events",
      "gas.between",
      "cw.events",
    ]);
  });
});

describe("cwGroupPaths", () => {
  beforeEach(() => {
    clearListGroups();
    eventListGroups().forEach(registerListGroup);
  });

  it("names the groups over Caseworking's boxes", () => {
    expect(cwGroupPaths()).toEqual(["events/cw"]);
  });
});

describe("listOfGroupMember", () => {
  beforeEach(() => {
    clearListGroups();
    eventListGroups().forEach(registerListGroup);
  });

  it("answers a member's group, picked to it", () => {
    const { buckets } = compose(eventEntries());

    expect(listOfGroupMember({ buckets }, "cw.inbox")).toEqual({
      path: "events/cw",
      query: { queue: "inbox" },
    });
  });

  it("answers no list for a member whose group isn't listed", () => {
    expect(
      listOfGroupMember(
        { buckets: [anEventEntry("cw.inbox", [])] },
        "cw.inbox",
      ),
    ).toBeNull();
  });

  it("answers the group with no catalogue to read", () => {
    expect(listOfGroupMember(null, "gas.outbox")).toEqual({
      path: "events/gas",
      query: { queue: "outbox" },
    });
  });
});
