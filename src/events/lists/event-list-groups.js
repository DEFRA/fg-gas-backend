import { NO_ERROR_KEY } from "../../common/buckets/error-key.js";
import { EVENT_BOXES, EVENT_SERVICES } from "../event-boxes.js";
import { UNRECOGNISED } from "../event-types.js";

const ORDER = { GAS: 10, CW: 30 };
const BOX_LABELS = { outbox: "Outbox", inbox: "Inbox" };

// Each service's events as one list over its outbox and inbox, the box picked
// as the Queue. The boxes are the services' own buckets, Caseworking's too:
// this module owns the box vocabulary both services' events use.
const toGroup = ({ value: service }) => {
  const prefix = service.toLowerCase();

  return {
    id: `${prefix}.events`,
    path: `events/${prefix}`,
    service,
    label: `${service} events`,
    shortLabel: "Events",
    icon: "activity",
    order: ORDER[service],
    noun: { one: "event", many: "events" },
    time: { label: "Created" },
    pick: { name: "box", param: "queue", label: "Queue" },
    members: EVENT_BOXES.map(({ value }) => ({
      bucket: `${prefix}.${value}`,
      value,
      label: BOX_LABELS[value],
    })),
    // A fact named here is sorted by name, these values last: both boxes'
    // types, with the catch-all at the end.
    lastValues: { eventType: [UNRECOGNISED] },
    // A row keyed as holding no error has none, so it has no error name.
    ruledOut: [
      { beside: "lastError.name", fact: "errorKey", value: NO_ERROR_KEY },
    ],
  };
};

export const eventListGroups = () => EVENT_SERVICES.map(toGroup);
