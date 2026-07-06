import { getInternalCommandHandler } from "../../common/internal-command-bus.js";
import { internalCommandTypes } from "../../common/internal-command-types.js";
import { withTransaction } from "../../common/with-transaction.js";

const INTERNAL_AGREEMENT_CODES = ["pigs-might-fly"];

const isCreateAgreementCommand = (event) =>
  typeof event.type === "string" &&
  event.type.endsWith(`.${internalCommandTypes.AGREEMENT_CREATE}`);

export const isInternalAgreementCommand = (event) => {
  if (!isCreateAgreementCommand(event)) {
    return false;
  }

  return INTERNAL_AGREEMENT_CODES.includes(event.data?.code);
};

export const dispatchInternally = async (event) => {
  const handler = getInternalCommandHandler(
    internalCommandTypes.AGREEMENT_CREATE,
  );

  if (!handler) {
    throw new Error(
      `No internal command handler registered for "${internalCommandTypes.AGREEMENT_CREATE}"`,
    );
  }

  await withTransaction((session) => handler(event, session));
};
