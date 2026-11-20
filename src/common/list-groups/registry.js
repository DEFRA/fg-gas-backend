const groups = new Map();

export const registerListGroup = (group) => {
  if (groups.has(group.id)) {
    throw new Error(`List group "${group.id}" is already registered`);
  }

  groups.set(group.id, group);
};

export const listGroups = () => [...groups.values()];

export const clearListGroups = () => groups.clear();
