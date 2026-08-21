import jsonata from "jsonata";
import { toProcessExpression } from "../../../../common/resolve-process-mapping.js";

const jsonataPrefix = "jsonata:";

const isObject = (value) => value !== null && typeof value === "object";
const isNodeType = (node, type) => isObject(node) && node.type === type;
const stepsFor = (node) => node.steps ?? [];
const argumentsFor = (node) => node.arguments ?? [];
const nodeName = (node) => (isNodeType(node, "name") ? node.value : undefined);
const isRootVariable = (node) =>
  isNodeType(node, "variable") && node.value === "";
const isOutputsName = (node) => nodeName(node) === "outputs";

const isOutputsPath = (node) => {
  const steps = stepsFor(node);

  return (
    isNodeType(node, "path") &&
    isRootVariable(steps[0]) &&
    isOutputsName(steps[1])
  );
};

const isRootOutputsPath = (node) =>
  isOutputsPath(node) && stepsFor(node).length === 2;

const hasComputedProcessKey = (steps) => steps[1].stages || steps[2]?.stages;

const directDependency = (node) => {
  if (!isOutputsPath(node)) {
    return undefined;
  }

  const steps = stepsFor(node);
  const [, , processStep, outputStep] = steps;
  const processKey = nodeName(processStep);

  if (!processKey || hasComputedProcessKey(steps)) {
    throw new Error("Agreement Process output access must use a static key");
  }

  return { processKey, outputName: nodeName(outputStep) };
};

const isLookup = (node) =>
  isNodeType(node, "function") &&
  isNodeType(node.procedure, "variable") &&
  node.procedure.value === "lookup";

const lookupNode = (node) =>
  isNodeType(node, "path") ? stepsFor(node)[0] : node;

const isIndirectOutputsLookup = (node) => {
  const lookup = lookupNode(node);

  if (!isLookup(lookup)) {
    return false;
  }

  const args = argumentsFor(lookup);

  return (
    isRootVariable(args[0]) &&
    isNodeType(args[1], "string") &&
    args[1].value === "outputs"
  );
};

const outputAfterLookup = (node) => {
  if (!isNodeType(node, "path")) {
    return undefined;
  }

  return nodeName(stepsFor(node)[1]);
};

const containsOutputsPath = (node) => {
  if (isOutputsPath(node)) {
    return true;
  }

  return childNodes(node).some(containsOutputsPath);
};

const requireRootOutputsLookup = (node) => {
  if (containsOutputsPath(node)) {
    throw new Error("Agreement Process output lookup must target $.outputs");
  }
};

const lookupDependency = (node) => {
  const lookup = lookupNode(node);

  if (!isLookup(lookup)) {
    return undefined;
  }

  const args = argumentsFor(lookup);

  if (!isRootOutputsPath(args[0])) {
    requireRootOutputsLookup(args[0]);
    return undefined;
  }

  if (!isNodeType(args[1], "string")) {
    throw new Error("Dynamic Agreement Process output lookup is not supported");
  }

  return {
    processKey: args[1].value,
    outputName: outputAfterLookup(node),
  };
};

const childNodes = (node) =>
  Object.entries(node)
    .filter(([key]) => key !== "position")
    .flatMap(([_key, value]) => (Array.isArray(value) ? value : [value]))
    .filter(isObject);

const dependencyKey = ({ processKey, outputName }) =>
  `${processKey}\u0000${outputName ?? ""}`;

const rejectHiddenOutputAccess = (node) => {
  if (isNodeType(node, "string") && node.value.includes("$.outputs")) {
    throw new Error(
      "Agreement Process output access cannot be hidden in a string",
    );
  }
};

const rejectIndirectOutputAccess = (node) => {
  if (isIndirectOutputsLookup(node)) {
    throw new Error("Agreement Process output lookup must target $.outputs");
  }
};

const visitAst = (node, dependencies) => {
  rejectHiddenOutputAccess(node);
  rejectIndirectOutputAccess(node);
  const dependency = directDependency(node) ?? lookupDependency(node);

  if (dependency) {
    dependencies.set(dependencyKey(dependency), dependency);
    return;
  }

  for (const child of childNodes(node)) {
    visitAst(child, dependencies);
  }
};

const isOutputMapping = (value) =>
  value.startsWith(jsonataPrefix) || /^\$\.outputs(?:\.|\[|$)/.test(value);

const inspectString = (value, dependencies) => {
  if (!isOutputMapping(value)) {
    return;
  }

  visitAst(jsonata(toProcessExpression(value)).ast(), dependencies);
};

const inspectMapping = (mapping, dependencies) => {
  if (typeof mapping === "string") {
    inspectString(mapping, dependencies);
    return;
  }

  if (!isObject(mapping)) {
    return;
  }

  for (const value of Object.values(mapping)) {
    inspectMapping(value, dependencies);
  }
};

export const findProcessOutputDependencies = (definition) => {
  const dependencies = new Map();

  inspectMapping(definition.request, dependencies);
  inspectMapping(definition.input, dependencies);
  inspectMapping(definition.output, dependencies);

  return [...dependencies.values()];
};
