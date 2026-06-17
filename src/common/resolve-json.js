import jsonata from "jsonata";
import { JSONPath } from "jsonpath-plus";
import { applyFormat } from "./format.js";
import { logger } from "./logger.js";

export const resolveJSONPath = async ({ root, path, row }) => {
  if (path === null) {
    return path;
  }

  if (typeof path === "string") {
    return resolveJSONString({ path, root, row });
  }

  if (Array.isArray(path)) {
    return resolveJSONArray({ path, root, row });
  }

  if (typeof path === "object") {
    return resolveJSONObject({ path, root, row });
  }

  return path;
};

const resolveJSONString = async ({ path, root, row }) => {
  if (isLiteralRef(path)) {
    return path.slice(1);
  }

  if (isJSONataExpression(path)) {
    return evaluateJSONata({ path, root, row });
  }

  if (isFallbackExpression(path)) {
    return resolveFallbackExpression({ path, root, row });
  }

  if (hasMultipleRefs(path)) {
    return resolveMultipleRefs({ path, root, row });
  }

  if (isRef(path)) {
    return jp({ root, path, row });
  }

  if (hasInlineRefs(path)) {
    return resolveInlineRefs({ path, root, row });
  }

  return path;
};

const shouldSpreadArray = (item, resolved) =>
  Array.isArray(resolved) &&
  (isRepeat(item) ||
    isTemplate(item) ||
    isComponentContainer(item) ||
    (isConditional(item) &&
      resolved.every((value) => value && typeof value === "object")));

const resolveJSONArray = async ({ path, root, row }) => {
  const results = [];

  for (const item of path) {
    const resolved = await resolveJSONPath({ root, path: item, row });

    if (resolved === undefined) {
      continue;
    }

    if (shouldSpreadArray(item, resolved)) {
      results.push(...resolved);
    } else {
      results.push(resolved);
    }
  }

  return results;
};

const resolveJSONObject = async ({ path, root, row }) => {
  const specialCase = await handleSpecialCases({ path, root, row });
  if (specialCase !== null) {
    return specialCase;
  }

  return applyFormatsRecursively(
    await resolveGenericObject({ path, root, row }),
  );
};

const handleSpecialCases = async ({ path, root, row }) => {
  if (isConditional(path)) {
    return resolveConditionalComponent({ path, root, row });
  }

  if (hasDisplayCondition(path)) {
    return resolveConditionedObject({ path, root, row });
  }

  if (isTable(path)) {
    return resolveTableSection({ path, root, row });
  }

  if (isRepeat(path)) {
    return resolveRepeatComponent({ path, root, row });
  }

  if (isTemplate(path)) {
    return resolveTemplateComponent({ path, root, row });
  }

  if (isComponentContainer(path)) {
    return resolveComponentContainer({ path, root, row });
  }

  if ("urlTemplate" in path) {
    return resolveUrlTemplate({ path, root, row });
  }

  return null;
};

const isTable = (path) => path.rowsRef && path.rows;
const isRepeat = (path) =>
  path.component === "repeat" && path.itemsRef && path.items;
const isTemplate = (path) =>
  path.component === "template" && path.templateRef && path.templateKey;
const isComponentContainer = (path) =>
  path.component === "component-container" && path.contentRef;
const isConditional = (path) =>
  path.component === "conditional" &&
  path.condition &&
  (Object.hasOwn(path, "whenTrue") || Object.hasOwn(path, "whenFalse"));
const hasDisplayCondition = (path) => path.condition;

const resolveGenericObject = async ({ path, root, row }) => {
  const resolved = {};

  for (const [key, val] of Object.entries(path)) {
    const resolvedValue = await resolveJSONPath({ root, path: val, row });
    if (resolvedValue !== undefined) {
      resolved[key] = resolvedValue;
    }
  }

  if ("component" in path && !resolved.component) {
    resolved.component = "text";
  }

  return resolved;
};

const applyFormatsRecursively = (value) => {
  if (Array.isArray(value)) {
    return value.map(applyFormatsRecursively);
  }

  if (typeof value === "object" && value !== null) {
    return applyFormatsToObject(value);
  }

  return value;
};

const applyFormatsToObject = (obj) => {
  const result = { ...obj };

  if (result.format && result.text !== undefined) {
    result.text = applyFormat(result.text, result.format);
    delete result.format;
  }

  Object.keys(result).forEach((key) => {
    result[key] = applyFormatsRecursively(result[key]);
  });

  return result;
};

const resolveUrlTemplate = async ({ path, root, row }) => {
  const template = await resolveJSONPath({ root, path: path.urlTemplate, row });
  const params = await resolveJSONPath({ root, path: path.params || {}, row });

  return populateUrlTemplate(template, params);
};

const resolveTableSection = async ({ path, root, row }) => {
  const { rowsRef, rows, ...resolvable } = path;
  const dataRows = await resolveDataRef({ root, path: rowsRef, row });
  const tableRows = [];

  for (const rowItem of dataRows) {
    tableRows.push(await resolveJSONPath({ root, path: rows, row: rowItem }));
  }

  const resolvedSection = await resolveJSONPath({
    root,
    path: resolvable,
    row,
  });
  resolvedSection.rows = tableRows;

  return resolvedSection;
};

const resolveRepeatComponent = async ({ path, root, row }) => {
  const { itemsRef, items, beforeContent, emptyContent } = path;
  const dataItems = await resolveDataRef({ root, path: itemsRef, row });

  if (!dataItems.length) {
    return resolveOptionalContentArray({ root, path: emptyContent, row });
  }

  const repeatedItems = await resolveOptionalContentArray({
    root,
    path: beforeContent,
    row,
  });

  for (const itemData of dataItems) {
    const resolved = await resolveJSONPath({
      root,
      path: items,
      row: itemData,
    });
    if (Array.isArray(resolved)) {
      repeatedItems.push(...resolved);
    } else {
      repeatedItems.push(resolved);
    }
  }

  return repeatedItems;
};

const resolveOptionalContentArray = async ({ root, path, row }) => {
  if (path === undefined) {
    return [];
  }

  return toArray(await resolveJSONPath({ root, path, row }));
};

const resolveTemplateComponent = async ({ path, root, row }) => {
  const dataRow = await resolveTemplateDataRow({ path, root, row });
  const templateGroup = await resolveJSONPath({
    root,
    path: path.templateRef,
    row,
  });
  const templateKey = await resolveJSONPath({
    root,
    path: path.templateKey,
    row,
  });
  const templateContent = templateGroup?.[templateKey]?.content;

  if (!Array.isArray(templateContent)) {
    return [];
  }

  return resolveJSONPath({ root, path: templateContent, row: dataRow });
};

const resolveTemplateDataRow = async ({ path, root, row }) => {
  if (!path.dataRef) {
    return row;
  }

  const [resolvedRow = ""] = await resolveDataRef({
    root,
    path: path.dataRef,
    row,
  });
  return resolvedRow;
};

const resolveComponentContainer = async ({ path, root, row }) => {
  const content = jp({ root, path: path.contentRef, row }) || [];
  const resolvedItems = [];

  for (const item of content) {
    resolvedItems.push(await resolveJSONPath({ root, path: item, row }));
  }

  return resolvedItems;
};

const resolveConditionalComponent = async ({ path, root, row }) => {
  const { condition, whenFalse, whenTrue } = path;
  const conditionResult = await resolveDataRef({ root, path: condition, row });
  const selectedComponent = evaluateConditionResult(conditionResult)
    ? whenTrue
    : whenFalse;

  if (selectedComponent === undefined) {
    return undefined;
  }

  return resolveJSONPath({ root, path: selectedComponent, row });
};

const resolveConditionedObject = async ({ path, root, row }) => {
  const conditionResult = await resolveDataRef({
    root,
    path: path.condition,
    row,
  });

  if (!evaluateConditionResult(conditionResult)) {
    return undefined;
  }

  const { condition, ...conditionedPath } = path;
  return resolveJSONPath({ root, path: conditionedPath, row });
};

const refPatternSource =
  "(?:\\$|@)\\.(?:[A-Za-z_$][\\w$-]*|\\[[^\\]]+\\]|\\*)(?:(?:\\.(?:[A-Za-z_$][\\w$-]*|\\*))|\\[[^\\]]+\\])*";

const createInlineRefPattern = () =>
  new RegExp(`(^|[^\\\\])(${refPatternSource})`, "g");

const createFallbackExpressionPattern = () =>
  new RegExp(`^(${refPatternSource})\\s*(\\?\\?|\\|\\|)\\s*(.+)$`);

const hasInlineRefs = (path) => createInlineRefPattern().test(path);

const resolveInlineRefs = ({ path, root, row }) =>
  path.replace(createInlineRefPattern(), (match, prefix, ref) => {
    const resolved = jp({ root, path: ref, row });

    return `${prefix}${toText(resolved)}`;
  });

const hasMultipleRefs = (path) => {
  const parts = path.split(" ").filter((part) => part !== "");
  return parts.length > 1 && parts.every((part) => isRef(part));
};

const isFallbackExpression = (path) =>
  createFallbackExpressionPattern().test(path);

const resolveFallbackExpression = async ({ path, root, row }) => {
  const [, ref, operator, fallback] = path.match(
    createFallbackExpressionPattern(),
  );
  const values = evalPath({ root, path: ref, row });
  const [value] = values;

  if (!shouldUseFallback({ operator, value, values })) {
    return value;
  }

  return resolveFallbackValue({ fallback, root, row });
};

const shouldUseFallback = ({ operator, value, values }) => {
  if (!values.length) {
    return true;
  }

  if (operator === "??") {
    return value === null || value === undefined;
  }

  return !value;
};

const resolveFallbackValue = ({ fallback, root, row }) => {
  const value = fallback.trim();

  if (isRef(value) || isJSONataExpression(value)) {
    return resolveJSONPath({ root, path: value, row });
  }

  return parseFallbackLiteral(value);
};

const booleanLiterals = {
  false: false,
  true: true,
};

const isBooleanLiteral = (value) => Object.hasOwn(booleanLiterals, value);

const isNumberLiteral = (value) => /^-?\d+(\.\d+)?$/.test(value);

const parseFallbackLiteral = (value) => {
  if (isBooleanLiteral(value)) {
    return booleanLiterals[value];
  }

  if (value === "null") {
    return null;
  }

  return isNumberLiteral(value) ? Number(value) : stripQuotes(value);
};

const stripQuotes = (value) => value.replace(/^['"]|['"]$/g, "");

const resolveMultipleRefs = ({ path, root, row }) =>
  path
    .split(" ")
    .map((part) => (isRef(part) ? jp({ root, path: part, row }) : part))
    .filter((value) => value !== "")
    .join(" ");

const isRef = (path) => isRootRef(path) || isRowRef(path);
const hasTrailingPunctuation = (path) => /[.,;:!?]$/.test(path);
const isRootRef = (path) =>
  typeof path === "string" &&
  /^\$\.\S+$/.test(path) &&
  !hasTrailingPunctuation(path);
const isRowRef = (path) =>
  typeof path === "string" &&
  /^@\.\S+$/.test(path) &&
  !hasTrailingPunctuation(path);
const isLiteralRef = (path) =>
  typeof path === "string" &&
  (path.startsWith("\\$.") || path.startsWith("\\@."));
const isJSONataExpression = (path) =>
  typeof path === "string" && path.startsWith("jsonata:");

const toArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [value];
};

const toText = (value) => {
  if (value === undefined || value === null) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.join(" ");
  }

  return String(value);
};

const resolveDataRef = async ({ root, path, row }) => {
  if (typeof path !== "string") {
    return [];
  }

  if (isJSONataExpression(path)) {
    return toArray(await evaluateJSONata({ path, root, row }));
  }

  return evalPath({ root, path, row });
};

const evaluateJSONata = async ({ path, root, row }) => {
  try {
    const expression = path.replace("jsonata:", "").replaceAll("@.", "$row.");
    const compiledExpression = jsonata(expression);
    if (row !== undefined && row !== null) {
      compiledExpression.assign("row", row);
    }
    return await compiledExpression.evaluate(root);
  } catch (error) {
    logger.warn(error, `JSONata ${path} resulted in code ${error.code})`);
    return undefined;
  }
};

export const jp = ({ root, path, row }) => {
  const out = evalPath({ root, path, row });
  return out.length ? out[0] : "";
};

const evalPath = ({ root, path, row }) => {
  if (typeof path !== "string" || isLiteralRef(path)) {
    return [];
  }

  if (isRootRef(path)) {
    return JSONPath({ json: root, path });
  }

  if (isRowRef(path)) {
    return resolveRow({ path, row });
  }

  return JSONPath({ json: root, path });
};

const resolveRow = ({ path, row }) => {
  if (row === null || row === undefined) {
    return [];
  }

  return JSONPath({ json: row, path: "$." + path.slice(2) });
};

export const populateUrlTemplate = (template, params) =>
  template.replace(/\{([^}]{0,100})}/g, (_, key) =>
    encodeURIComponent(params[key] ?? ""),
  );

const evaluateConditionResult = (conditionResult) => {
  if (Array.isArray(conditionResult)) {
    return conditionResult.length > 0 && Boolean(conditionResult[0]);
  }

  return Boolean(conditionResult);
};
