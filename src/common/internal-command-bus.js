const handlers = new Map();

export const registerInternalCommandHandler = (
  type,
  handler,
  { canHandle } = {},
) => {
  handlers.set(type, { handler, canHandle });
};

export const getInternalCommandHandler = (type) => handlers.get(type)?.handler;

export const canHandleInternalCommand = (type, command) => {
  const registration = handlers.get(type);

  return Boolean(
    registration &&
    (registration.canHandle === undefined || registration.canHandle(command)),
  );
};

export const clearInternalCommandHandlers = () => handlers.clear();
