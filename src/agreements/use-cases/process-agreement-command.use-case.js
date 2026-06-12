import { withTransaction } from "../../common/with-transaction.js";
import {
  agreementCommandNames,
  agreementCommandRoutes,
  getAgreementCommandRoute,
} from "../models/agreement-definition.js";
import { processCreateAgreementCommandUseCase } from "./process-create-agreement-command.use-case.js";

const isAgreementCommand = (command) => command.type?.includes(".agreement.");

const getAgreementCommandName = (command) => {
  if (command.type?.endsWith(".agreement.create")) {
    return agreementCommandNames.CREATE;
  }

  return null;
};

const getCommandRoute = ({ command, commandName }) =>
  getAgreementCommandRoute({
    agreementCode: command.data.code,
    commandName,
  });

const processCreateCommand = async (command) => {
  const route = getCommandRoute({
    command,
    commandName: agreementCommandNames.CREATE,
  });

  if (route !== agreementCommandRoutes.INTERNAL) {
    return agreementCommandRoutes.LEGACY;
  }

  return withTransaction(async (session) => {
    await processCreateAgreementCommandUseCase(command, session);
    return agreementCommandRoutes.INTERNAL;
  });
};

const processCommand = async (command) => {
  const commandName = getAgreementCommandName(command);

  if (commandName === agreementCommandNames.CREATE) {
    return processCreateCommand(command);
  }

  return agreementCommandRoutes.LEGACY;
};

export const processAgreementCommandUseCase = {
  canProcess: isAgreementCommand,
  process: processCommand,
};
