export const agreementImplementations = {
  CONFIG: "config",
  LEGACY: "legacy",
};

export const agreementCommandNames = {
  CREATE: "create",
};

export const agreementCommandRoutes = {
  INTERNAL: "internal",
  LEGACY: "legacy",
};

const agreementDefinitions = new Map([
  [
    "pigs-might-fly",
    {
      agreementCode: "pigs-might-fly",
      implementation: agreementImplementations.CONFIG,
      configVersion: "0.0.1",
      agreementNumber: {
        prefix: "PMF",
        randomDigits: 9,
        uniquenessScope: "agreementNumber",
      },
      commands: {
        [agreementCommandNames.CREATE]: {
          route: agreementCommandRoutes.INTERNAL,
        },
      },
      lifecycle: {
        initialStatus: "offered",
        initialChangeType: "created",
        changedBy: "system",
        fromStatus: null,
      },
    },
  ],
]);

export const getAgreementDefinition = (agreementCode) =>
  agreementDefinitions.get(agreementCode) ?? {
    agreementCode,
    implementation: agreementImplementations.LEGACY,
  };

export const getAgreementCommandRoute = ({ agreementCode, commandName }) =>
  getAgreementDefinition(agreementCode).commands?.[commandName]?.route ??
  agreementCommandRoutes.LEGACY;
