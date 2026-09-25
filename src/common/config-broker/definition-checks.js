const checks = new Map();

export const registerDefinitionCheck = (definitionType, check) => {
  checks.set(definitionType, check);
};

const getDefinitionCheck = (definitionType) => {
  const check = checks.get(definitionType);

  if (!check) {
    throw new Error(
      `No configuration definition check registered for ${definitionType}`,
    );
  }

  return check;
};

export const assertDefinitionCheckRegistered = (definitionType) => {
  getDefinitionCheck(definitionType);
};

export const checkDefinition = (definitionType, context) =>
  getDefinitionCheck(definitionType)(context);

export const clearDefinitionChecks = () => checks.clear();
