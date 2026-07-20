import { getInternalMessageHandler } from "../../common/internal-message-bus.js";
import { internalMessageTypes } from "../../common/internal-message-types.js";

const INTERNAL_AGREEMENT_CODES = ["pigs-might-fly"];

const isCreateAgreementCommand = (event) =>
  typeof event.type === "string" &&
  event.type.endsWith(`.${internalMessageTypes.AGREEMENT_CREATE}`);

export const isInternalAgreementCommand = (event) => {
  if (!isCreateAgreementCommand(event)) {
    return false;
  }

  return INTERNAL_AGREEMENT_CODES.includes(event.data?.code);
};

const getInternalMessageType = (event) =>
  Object.values(internalMessageTypes).find(
    (type) => event.type === type || event.type?.endsWith(`.${type}`),
  );

export const dispatchInternally = async (event) => {
  const type = getInternalMessageType(event);
  const handler = getInternalMessageHandler(type);

  if (!handler) {
    throw new Error(
      `No internal message handler registered for "${type ?? event.type}"`,
    );
  }

  await handler(event);
};
