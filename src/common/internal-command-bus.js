import { internalCommandTypes } from "./internal-command-types.js";

export const internalMessageBusTarget = "internal:message-bus";

const handlers = new Map();
const internalTypes = Object.values(internalCommandTypes);

const getInternalType = (event) =>
  internalTypes.find(
    (type) =>
      event.type === type ||
      (typeof event.type === "string" && event.type.endsWith(`.${type}`)),
  );

export const registerInternalCommandHandler = (
  type,
  handler,
  { canHandle } = {},
) => {
  handlers.set(type, { handler, canHandle });
};

export const getInternalCommandHandler = (type) => handlers.get(type)?.handler;

export const canHandleInternalCommand = async (type, command) => {
  const registration = handlers.get(type);

  if (!registration) {
    return false;
  }
  if (registration.canHandle === undefined) {
    return true;
  }
  return Boolean(await registration.canHandle(command));
};

export const dispatchInternally = async (event) => {
  const type = getInternalType(event);
  const handler = getInternalCommandHandler(type);

  if (!handler) {
    throw new Error(`No internal command handler registered for "${type}"`);
  }

  await handler(event);
};

export const clearInternalCommandHandlers = () => handlers.clear();
