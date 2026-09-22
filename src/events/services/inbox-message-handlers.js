const handlers = new Map();

export const registerInboxMessageHandler = (source, handler) => {
  const registered = handlers.get(source);
  if (registered && registered !== handler) {
    throw new Error(`Inbox message handler already registered for "${source}"`);
  }

  handlers.set(source, handler);
};

export const dispatchInboxMessage = async (message) => {
  const handler = handlers.get(message.source);
  if (!handler) {
    throw new Error(
      `No inbox message handler registered for source "${message.source}"`,
    );
  }

  await handler(message);
};

export const clearInboxMessageHandlers = () => handlers.clear();
