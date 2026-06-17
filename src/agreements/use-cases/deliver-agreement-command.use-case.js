import { withTransaction } from "../../common/with-transaction.js";
import { getAgreementCommandRoute } from "../models/agreement-definition-resolver.js";
import { processCreateAgreementCommandUseCase } from "./process-create-agreement-command.use-case.js";

const commandNameByTypeSuffix = [
  [".agreement.create", "create"],
];

export const agreementCommandDeliveryOutcomes = {
  DELIVER_EXTERNALLY: "deliver-externally",
  DELIVER_INTERNALLY: "deliver-internally",
  DELIVERED_INTERNALLY: "delivered-internally",
  NOT_AGREEMENT_COMMAND: "not-agreement-command",
};

const getAgreementCommandName = (command) =>
  commandNameByTypeSuffix.find(([suffix]) =>
    command.type?.endsWith(suffix),
  )?.[1] ?? null;

const isAgreementCommand = (command) =>
  getAgreementCommandName(command) !== null;

const getCommandRoute = ({ command, commandName }) =>
  getAgreementCommandRoute({
    agreementCode: command.data.code,
    commandName,
  });

const getDeliveryOutcome = (route) =>
  route === "internal"
    ? agreementCommandDeliveryOutcomes.DELIVER_INTERNALLY
    : agreementCommandDeliveryOutcomes.DELIVER_EXTERNALLY;

export const resolveAgreementCommandDelivery = (command) => {
  const commandName = getAgreementCommandName(command);

  if (!commandName) {
    return {
      commandName,
      delivered: false,
      outcome: agreementCommandDeliveryOutcomes.NOT_AGREEMENT_COMMAND,
      route: "legacy",
    };
  }

  const route = getCommandRoute({ command, commandName });

  return {
    commandName,
    delivered: false,
    outcome: getDeliveryOutcome(route),
    route,
  };
};

const deliverInternalCreateCommand = async (command) =>
  withTransaction(async (session) => {
    await processCreateAgreementCommandUseCase(command, session);

    return true;
  });

const toDeliveredInternallyResult = (delivery) => ({
  ...delivery,
  delivered: true,
  outcome: agreementCommandDeliveryOutcomes.DELIVERED_INTERNALLY,
});

const deliverCreateCommand = async ({ command, delivery }) => {
  if (delivery.route !== "internal") {
    return delivery;
  }

  await deliverInternalCreateCommand(command);

  return toDeliveredInternallyResult(delivery);
};

const agreementCommandHandlers = {
  create: deliverCreateCommand,
};

export const deliverAgreementCommandResult = async (command) => {
  const delivery = resolveAgreementCommandDelivery(command);
  const handler = agreementCommandHandlers[delivery.commandName];

  if (!handler) {
    return delivery;
  }

  return handler({ command, delivery });
};

export const deliverAgreementCommand = async (command) =>
  (await deliverAgreementCommandResult(command)).delivered;

export const agreementCommandDelivery = {
  canDeliver: ({ event }) => isAgreementCommand(event),
  deliver: ({ event }) => deliverAgreementCommand(event),
};
