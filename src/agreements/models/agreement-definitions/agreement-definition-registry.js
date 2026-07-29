import { pmfAgreementDefinition } from "./pmf.js";

const agreementDefinitionsByCode = new Map([
  [
    pmfAgreementDefinition.code,
    {
      defaultVersion: pmfAgreementDefinition.configVersion,
      definitionsByVersion: new Map([
        [pmfAgreementDefinition.configVersion, pmfAgreementDefinition],
      ]),
    },
  ],
]);

export const agreementDefinitions = [
  ...agreementDefinitionsByCode.values(),
].flatMap(({ definitionsByVersion }) => [...definitionsByVersion.values()]);

export const findAgreementDefinition = ({ code }) => {
  const registeredDefinitions = agreementDefinitionsByCode.get(code);

  return registeredDefinitions?.definitionsByVersion.get(
    registeredDefinitions.defaultVersion,
  );
};
