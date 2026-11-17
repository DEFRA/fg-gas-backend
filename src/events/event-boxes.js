// The services whose inbox and outbox an event is kept in, and the boxes.
export const EVENT_SERVICES = [
  { value: "GAS", label: "Grant Application Service" },
  { value: "CW", label: "Caseworking" },
];

export const EVENT_BOXES = [
  { value: "outbox", label: "outbox" },
  { value: "inbox", label: "inbox" },
];
