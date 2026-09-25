import { internalCommandTypes } from "./internal-command-types.js";

export const internalCommandTarget = "internal:command";

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

// Ownership can only be answered by reading the config catalog, so the
// predicate is awaited. Callers must await too: an unawaited promise is always
// truthy, which silently claims every command for the internal handler.
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

export const dispatchCommand = async (command) => {
  const type = getInternalType(command);
  const handler = getInternalCommandHandler(type);

  if (!handler) {
    throw new Error(`No internal command handler registered for "${type}"`);
  }

  await handler(command);
};

export const clearInternalCommandHandlers = () => handlers.clear();
