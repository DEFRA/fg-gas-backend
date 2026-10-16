export const AUDIT = "Audit";
export const UNRECOGNISED = "Unrecognised";
export const OUTBOX = "outbox";
export const INBOX = "inbox";

const ENVIRONMENT = /^cloud\.defra\.[^.]+\./;

const eventTypes = new Map();

const declared = () => [...eventTypes.values()];

const assertSentAsIsFree = ({ name, sentAs }) => {
  const other = declared().find(
    (eventType) => eventType.sentAs === sentAs && eventType.name !== name,
  );

  if (sentAs && other) {
    throw new Error(
      `Event type "${sentAs}" is already declared as "${other.name}"`,
    );
  }
};

// name: the stamp. sentAs: the envelope `type` as it travels. recognise: for an
// envelope with no `type`. boxes: where this service meets it. refs: the row's
// identifiers as [kind, value] pairs, read once by the writer from the envelope
// and the row's ordering key; must never throw (read with `?.`). hiddenByDefault: left out of a list until it is asked for.
export const defineEventType = ({
  name,
  sentAs,
  recognise,
  boxes,
  refs = () => [],
  hiddenByDefault = false,
}) => {
  const eventType = Object.freeze({
    name,
    sentAs,
    recognise,
    boxes: Object.freeze([...boxes]),
    refs,
    hiddenByDefault,
  });

  assertSentAsIsFree(eventType);
  eventTypes.set(name, eventType);

  return eventType;
};

const anyEnvironment = (type) =>
  typeof type === "string" ? type.replace(ENVIRONMENT, "cloud.defra.*.") : type;

const isSentAs = (type) => (eventType) =>
  eventType.sentAs !== undefined && eventType.sentAs === type;

const isSentAsInAnyEnvironment = (type) => (eventType) =>
  eventType.sentAs !== undefined &&
  anyEnvironment(eventType.sentAs) === anyEnvironment(type);

const recognises = (event) => (eventType) =>
  Boolean(eventType.recognise) && eventType.recognise(event);

const firstOf = (matchers) => {
  for (const matches of matchers) {
    const eventType = declared().find((candidate) => matches(candidate));

    if (eventType) {
      return eventType;
    }
  }

  return null;
};

export const findEventType = (event) =>
  firstOf([isSentAs(event.type), recognises(event)]);

export const findEventTypeInAnyEnvironment = (event) =>
  firstOf([
    isSentAs(event.type),
    recognises(event),
    isSentAsInAnyEnvironment(event.type),
  ]);

// Written by its own writer, never matched from an envelope.
export const audit = defineEventType({
  name: AUDIT,
  boxes: [OUTBOX],
  hiddenByDefault: true,
});

const unrecognised = { name: UNRECOGNISED, hiddenByDefault: false };

const eventTypesOf = (box) => [
  ...declared()
    .filter((eventType) => eventType.boxes.includes(box))
    .sort((a, b) => a.name.localeCompare(b.name)),
  unrecognised,
];

export const eventTypeNames = (box) =>
  eventTypesOf(box).map((eventType) => eventType.name);

const toValue = ({ name, hiddenByDefault }) =>
  hiddenByDefault
    ? { value: name, label: name, hidden: true }
    : { value: name, label: name };

// The box's types as the listed values of a bucket's event type fact.
export const eventTypeValues = (box) => eventTypesOf(box).map(toValue);
