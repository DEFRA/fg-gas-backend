import Boom from "@hapi/boom";

const pathPrefix = "$.";

export const resolveActionPath = (root, path) => {
  if (!path?.startsWith(pathPrefix)) {
    return path;
  }

  return path
    .slice(pathPrefix.length)
    .split(".")
    .reduce((current, part) => current?.[part], root);
};

export const resolveActionMap = ({ map = {}, root }) =>
  Object.fromEntries(
    Object.entries(map).map(([key, value]) => [
      key,
      resolveActionValue({ root, value }),
    ]),
  );

const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const resolveActionArray = ({ root, values }) =>
  values.map((value) => resolveActionValue({ root, value }));

export const resolveActionValue = ({ root, value }) => {
  if (typeof value === "string") {
    return resolveActionPath(root, value);
  }

  if (Array.isArray(value)) {
    return resolveActionArray({ root, values: value });
  }

  if (isObject(value)) {
    return resolveActionMap({ map: value, root });
  }

  return value;
};

export const setActionPath = ({ object, path, place, value }) => {
  const parts = path.split(".");
  const property = parts.pop();
  const target = parts.reduce((current, part) => {
    current[part] ??= {};
    return current[part];
  }, object);

  if (place === "merge") {
    target[property] = {
      ...(target[property] ?? {}),
      ...value,
    };
    return;
  }

  if (place === "replace") {
    target[property] = value;
    return;
  }

  throw Boom.badRequest(`Unsupported Agreement action output place "${place}"`);
};

const getActionTargetNode = ({ object, target }) => {
  object[target.targetNode] ??= target.dataType === "ARRAY" ? [] : {};

  return object[target.targetNode];
};

const setActionArrayTarget = ({ data, key, targetData }) => {
  if (!key) {
    targetData.push(data);
    return targetData;
  }

  const existingIndex = targetData.findIndex((item) => item[key] === data[key]);

  if (existingIndex === -1) {
    targetData.push(data);
    return targetData;
  }

  return targetData.map((item, index) =>
    index === existingIndex ? data : item,
  );
};

const setActionObjectTarget = ({ data, key, targetData, targetNode }) => {
  if (!key) {
    throw Boom.badRequest(
      `Can not update Agreement action target "${targetNode}" as an object without a key`,
    );
  }

  return {
    ...targetData,
    [data[key]]: data,
  };
};

export const setActionTarget = ({ object, target, value }) => {
  if (target.place !== "append") {
    throw Boom.badRequest(
      `Unsupported Agreement action target place "${target.place}"`,
    );
  }

  const targetData = getActionTargetNode({ object, target });

  if (target.dataType === "ARRAY") {
    object[target.targetNode] = setActionArrayTarget({
      data: value,
      key: target.key,
      targetData,
    });
    return;
  }

  if (target.dataType === "OBJECT") {
    object[target.targetNode] = setActionObjectTarget({
      data: value,
      key: target.key,
      targetData,
      targetNode: target.targetNode,
    });
    return;
  }

  throw Boom.badRequest(
    `Unsupported Agreement action target data type "${target.dataType}"`,
  );
};

export const setActionOutput = ({ object, output, value }) => {
  if (output.target) {
    setActionTarget({ object, target: output.target, value });
    return;
  }

  setActionPath({
    object,
    path: output.path,
    place: output.place,
    value,
  });
};
