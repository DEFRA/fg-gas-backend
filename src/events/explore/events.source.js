import {
  eventAdded,
  eventPaths,
  eventStar,
  openEvent,
} from "./event-fields.js";

export const eventsSource = {
  name: "events",
  label: "Events, in both services",
  service: "GAS",
  size: "big",
  requires: null,
  noun: { one: "event", many: "events" },
  time: "publicationDate",
  star: eventStar,
  added: eventAdded,
  answersAt: null,
  boxes: [
    { bucket: "gas.outbox", service: "GAS", box: "outbox" },
    { bucket: "gas.inbox", service: "GAS", box: "inbox" },
  ],
  open: openEvent,
  openPaths: [],
  paths: eventPaths,
};
