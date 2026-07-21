import { getInternalCommandHandler } from "../../common/internal-command-bus.js";
import { internalCommandTypes } from "../../common/internal-command-types.js";

const INTERNAL_AGREEMENT_CODES = ["pigs-might-fly"];
const internalTypes = Object.values(internalCommandTypes);

const getInternalType = (event) =>
  internalTypes.find(
    (type) =>
      event.type === type ||
      (typeof event.type === "string" && event.type.endsWith(`.${type}`)),
  );

const isSupportedCreateAgreementCommand = (event, type) =>
  type !== internalCommandTypes.AGREEMENT_CREATE ||
  INTERNAL_AGREEMENT_CODES.includes(event.data?.code);

export const isInternalAgreementCommand = (event) => {
  const type = getInternalType(event);

  return Boolean(type && isSupportedCreateAgreementCommand(event, type));
};

export const dispatchInternally = async (event) => {
  const type = getInternalType(event);
  const handler = getInternalCommandHandler(type);

  if (!handler) {
    throw new Error(`No internal command handler registered for "${type}"`);
  }

  await handler(event);
};
