export const internalEventTarget = "internal:event";

const handlers = new Map();

export const registerEventHandler = (type, handler) => {
  const registered = handlers.get(type);
  if (registered && registered !== handler) {
    throw new Error(`Event handler already registered for type "${type}"`);
  }

  handlers.set(type, handler);
};

export const dispatchEvent = async (message) => {
  const handler = handlers.get(message.type);
  if (!handler) {
    throw new Error(`No event handler registered for type "${message.type}"`);
  }

  await handler(message);
};

export const clearEventHandlers = () => handlers.clear();
