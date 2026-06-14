import {
  agreementCommandDelivery,
  deliverAgreementCommand,
} from "./deliver-agreement-command.use-case.js";

export const agreementCommandRoutes = {
  INTERNAL: "internal",
  LEGACY: "legacy",
};

const toAgreementCommandRoute = (delivered) =>
  delivered ? agreementCommandRoutes.INTERNAL : agreementCommandRoutes.LEGACY;

export const processAgreementCommandUseCase = {
  canProcess: (command) =>
    agreementCommandDelivery.canDeliver({ event: command }),
  process: async (command) =>
    toAgreementCommandRoute(await deliverAgreementCommand(command)),
};
