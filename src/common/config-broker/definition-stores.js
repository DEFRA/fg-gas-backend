const stores = new Map();

// Each context that owns a Definition File registers how it stores that file,
// so Grants can ask about another context's files without importing it.
export const registerDefinitionStore = (definitionType, store) => {
  stores.set(definitionType, store);
};

const getDefinitionStore = (definitionType) => {
  const store = stores.get(definitionType);

  if (!store) {
    throw new Error(
      `No configuration definition store registered for ${definitionType}`,
    );
  }

  return store;
};

export const storedDefinitionVersions = async (
  definitionType,
  grantCode,
  versions,
) =>
  new Set(
    await getDefinitionStore(definitionType).storedVersions(
      grantCode,
      versions,
    ),
  );

export const findStoredDefinition = async (definitionType, ref, options) => {
  const { find } = getDefinitionStore(definitionType);

  if (!find) {
    throw new Error(
      `The ${definitionType} definition store cannot find a stored definition`,
    );
  }

  return find(ref, options);
};

export const clearDefinitionStores = () => stores.clear();
