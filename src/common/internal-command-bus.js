const handlers = new Map();

export const registerInternalCommandHandler = (type, handler) => {
  handlers.set(type, handler);
};

export const getInternalCommandHandler = (type) => handlers.get(type);

export const clearInternalCommandHandlers = () => handlers.clear();
