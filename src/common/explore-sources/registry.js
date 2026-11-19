const sources = new Map();

export const registerExploreSource = (source) => {
  if (sources.has(source.name)) {
    throw new Error(`Explore source "${source.name}" is already registered`);
  }

  sources.set(source.name, source);
};

export const findExploreSource = (name) => sources.get(name);

export const listExploreSources = () => [...sources.values()];

export const clearExploreSources = () => sources.clear();
