const handlers = new Map();

export const registerInternalMessageHandler = (type, handler) => {
  handlers.set(type, handler);
};

export const getInternalMessageHandler = (type) => handlers.get(type);

export const clearInternalMessageHandlers = () => handlers.clear();
