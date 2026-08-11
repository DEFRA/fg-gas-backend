import { getInternalCommandHandler } from "../../common/internal-command-bus.js";
import { internalCommandTypes } from "../../common/internal-command-types.js";

const internalTypes = Object.values(internalCommandTypes);

const getInternalType = (event) =>
  internalTypes.find(
    (type) =>
      event.type === type ||
      (typeof event.type === "string" && event.type.endsWith(`.${type}`)),
  );

export const dispatchInternally = async (event) => {
  const type = getInternalType(event);
  const handler = getInternalCommandHandler(type);

  if (!handler) {
    throw new Error(`No internal command handler registered for "${type}"`);
  }

  await handler(event);
};
