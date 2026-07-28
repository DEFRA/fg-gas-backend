import { applyFormat } from "./format.js";
import { resolveCondition, resolveRefs } from "./resolve-refs.js";

const applyFormatsToObject = (value) => {
  const { format, ...rest } = value;
  const resolved = Object.fromEntries(
    Object.entries(rest).map(([key, item]) => [key, applyFormats(item)]),
  );

  return format === undefined
    ? resolved
    : { ...resolved, text: applyFormat(resolved.text, format) };
};

const applyFormats = (value) => {
  if (Array.isArray(value)) {
    return value.map(applyFormats);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  return applyFormatsToObject(value);
};

const toArray = (value) => (Array.isArray(value) ? value : [value]);

const hasOwn = (value, key) =>
  value !== null && typeof value === "object" && Object.hasOwn(value, key);

const requireArray = (value, { component, key, ref }) => {
  if (!Array.isArray(value)) {
    throw new Error(
      `A "${component}" component's "${key}" ("${ref}") must resolve to an array`,
    );
  }

  return value;
};

// Cell templates are resolved against a single row item, so "$." and "@." both
// address that row. "$." addressing the row is kept for definitions written
// before "@." existed; new configuration should use "@.".
const resolveCell = async (cellTemplate, rowItem) =>
  applyFormats(
    await resolveRefs(cellTemplate, { context: rowItem, row: rowItem }),
  );

const resolveRow = (rowTemplate, rowItem) =>
  Promise.all(rowTemplate.map((cell) => resolveCell(cell, rowItem)));

const resolveTable = async (component, scope) => {
  const { rowsRef, rows: rowTemplate, ...rest } = component;

  if (!rowsRef || !rowTemplate) {
    throw new Error(
      'A "table" component must configure both "rowsRef" and "rows"',
    );
  }

  const [resolvedRest, rowItems] = await Promise.all([
    resolveRefs(rest, scope),
    resolveRefs(rowsRef, scope),
  ]);

  const rows = await Promise.all(
    requireArray(rowItems, {
      component: "table",
      key: "rowsRef",
      ref: rowsRef,
    }).map((rowItem) => resolveRow(rowTemplate, rowItem)),
  );

  return [{ ...applyFormats(resolvedRest), rows }];
};

const resolveConditional = async (component, scope) => {
  const { condition, whenTrue, whenFalse } = component;
  const branch = (await resolveCondition(condition, scope))
    ? whenTrue
    : whenFalse;

  return branch === undefined
    ? []
    : resolveComponentList(toArray(branch), scope);
};

const resolveRepeat = async (component, scope) => {
  const { itemsRef, items, beforeContent, emptyContent } = component;
  const resolvedItems = requireArray(await resolveRefs(itemsRef, scope), {
    component: "repeat",
    key: "itemsRef",
    ref: itemsRef,
  });

  if (resolvedItems.length === 0) {
    return resolveComponentList(emptyContent ?? [], scope);
  }

  const before = await resolveComponentList(beforeContent ?? [], scope);
  const repeated = await Promise.all(
    resolvedItems.map((item) =>
      resolveComponentList(items, { ...scope, row: item }),
    ),
  );

  return [...before, ...repeated.flat()];
};

const resolveTemplate = async (component, scope) => {
  const { templateRef, templateKey, dataRef } = component;
  const [templates, key] = await Promise.all([
    resolveRefs(templateRef, scope),
    resolveRefs(templateKey, scope),
  ]);

  const template = hasOwn(templates, key) ? templates[key] : undefined;

  if (!template) {
    throw new Error(
      `A "template" component references "${templateRef}" which has no template "${key}"`,
    );
  }

  const row =
    dataRef === undefined ? scope.row : await resolveRefs(dataRef, scope);

  return resolveComponentList(template.content, { ...scope, row });
};

const resolveContainer = (component, scope) =>
  resolveComponentList(component.content, scope);

const resolvers = {
  conditional: resolveConditional,
  repeat: resolveRepeat,
  table: resolveTable,
  template: resolveTemplate,
  "component-container": resolveContainer,
};

const resolveDisplayComponent = async (component, scope) => [
  applyFormats(await resolveRefs(component, scope)),
];

const isHidden = async (condition, scope) =>
  condition !== undefined && !(await resolveCondition(condition, scope));

const resolveComponent = async (component, scope) => {
  if (component.component === "conditional") {
    return resolveConditional(component, scope);
  }

  const { condition, ...rest } = component;

  if (await isHidden(condition, scope)) {
    return [];
  }

  return (resolvers[rest.component] ?? resolveDisplayComponent)(rest, scope);
};

const resolveComponentList = async (components, scope) => {
  const resolved = await Promise.all(
    components.map((component) => resolveComponent(component, scope)),
  );

  return resolved.flat();
};

export const resolveComponents = (components, context) =>
  resolveComponentList(components, { context, row: undefined });
