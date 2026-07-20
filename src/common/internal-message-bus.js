const registrations = new Map();

const getRegistrationFor = (message) =>
  [...registrations.entries()].find(
    ([type]) => message.type === type || message.type?.endsWith(`.${type}`),
  )?.[1];

const getAcceptingRegistrationFor = (message) => {
  const registration = getRegistrationFor(message);

  return registration?.canHandle(message) ? registration : undefined;
};

export const registerInternalMessageHandler = ({
  type,
  handler,
  canHandle = () => true,
}) => {
  registrations.set(type, { handler, canHandle });
};

export const canHandleInternally = (message) =>
  getAcceptingRegistrationFor(message) !== undefined;

export const dispatchInternalMessage = async (message) => {
  const registration = getAcceptingRegistrationFor(message);

  if (!registration) {
    throw new Error(
      `No internal message handler registered for "${message.type}"`,
    );
  }

  await registration.handler(message);
};

export const clearInternalMessageHandlers = () => registrations.clear();
