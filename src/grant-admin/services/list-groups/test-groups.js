import { eventStatusValues } from "../../../events/event-status-values.js";
import { composeListGroups } from "./catalogue.js";

const BOX_ORDER = { outbox: 0, inbox: 10 };
const SERVICE_ORDER = { gas: 10, cw: 30 };

// A box's catalogue entry, as both services describe their event boxes.
export const anEventEntry = (id, types, overrides = {}) => {
  const [service, box] = id.split(".");

  return {
    id,
    path: `events/${service}/${box}`,
    label: `${service.toUpperCase()} ${box}`,
    service: service.toUpperCase(),
    shortLabel: box,
    icon: "activity",
    order: SERVICE_ORDER[service] + BOX_ORDER[box],
    noun: { one: "event", many: "events" },
    time: { label: box === "outbox" ? "Created" : "Received" },
    facts: [
      {
        name: "status",
        param: "status",
        label: "Status",
        values: eventStatusValues,
        toggle: null,
        within: null,
      },
      {
        name: "eventType",
        param: "event",
        label: "Event",
        values: types.map((value) => ({ value, label: value })),
        toggle: null,
        within: null,
      },
      {
        name: "lastError.name",
        param: "errorname",
        label: "Error name",
        values: null,
        toggle: null,
        within: null,
      },
      {
        name: "errorKey",
        param: "error",
        label: "Error",
        values: null,
        toggle: null,
        within: null,
      },
    ],
    refs: [
      { kind: "ref", label: "Reference" },
      { kind: "trace", label: "Trace ID" },
      { kind: "id", label: "Event ID" },
    ],
    indexes: [[], ["status"]],
    groupings: ["status"],
    title: { label: "Event", format: "eventType" },
    columns: [
      { key: "status", label: "Status", format: "badge", fact: "status" },
    ],
    audited: false,
    timeline: true,
    summaries: [
      {
        id: "errors",
        label: "Top errors",
        by: ["errorKey", "eventType"],
        among: { status: "DEAD_LETTER" },
        top: 20,
        none: "No error recorded",
      },
    ],
    page: null,
    tab: null,
    ...overrides,
  };
};

export const GAS_TYPES = {
  outbox: ["AgreementStatusUpdated", "Audit", "CreateCase", "Unrecognised"],
  inbox: ["AgreementStatusUpdated", "CaseStatusUpdated", "Unrecognised"],
};

export const CW_TYPES = {
  outbox: ["Audit", "CaseStatusUpdated", "Unrecognised"],
  inbox: ["CreateCase", "UpdateCaseStatus", "Unrecognised"],
};

export const eventEntries = () => [
  anEventEntry("gas.outbox", GAS_TYPES.outbox),
  anEventEntry("gas.inbox", GAS_TYPES.inbox),
  anEventEntry("cw.outbox", CW_TYPES.outbox),
  anEventEntry("cw.inbox", CW_TYPES.inbox),
];

// The views of the groups defined, as the shell keeps them beside the
// catalogue.
export const eventViews = () =>
  composeListGroups(eventEntries(), { cwRead: true }).views;
