const checks = new Map();

export const registerDefinitionCheck = (definitionType, check) => {
  checks.set(definitionType, check);
};

export const checkDefinition = (definitionType, context) => {
  const check = checks.get(definitionType);

  if (!check) {
    throw new Error(
      `No configuration definition check registered for ${definitionType}`,
    );
  }

  return check(context);
};

export const clearDefinitionChecks = () => checks.clear();
