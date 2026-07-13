import { resolveEffectParams } from "./effects/resolve-effect-params.js";
import { applyFormat } from "./format.js";

const isTableComponent = (component) => component.component === "table";

// Applied after ref resolution, anywhere in the tree: any object carrying a
// "format" key has it applied to its "text" field and stripped from the
// output, so format isn't limited to a specific component or position.
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

// Cell templates are resolved against a single row item (not the full render
// context) - refs like "$.description" address fields on that one row.
const resolveCell = async (cellTemplate, rowItem) =>
  applyFormats(await resolveEffectParams(cellTemplate, rowItem));

const resolveRow = (rowTemplate, rowItem) =>
  Promise.all(rowTemplate.map((cell) => resolveCell(cell, rowItem)));

const resolveTableComponent = async (component, context) => {
  const { rowsRef, rows: rowTemplate, ...rest } = component;

  if (!rowsRef || !rowTemplate) {
    throw new Error(
      'A "table" component must configure both "rowsRef" and "rows"',
    );
  }

  const [resolvedRest, rowItems] = await Promise.all([
    resolveEffectParams(rest, context),
    resolveEffectParams(rowsRef, context),
  ]);

  const rows = await Promise.all(
    rowItems.map((rowItem) => resolveRow(rowTemplate, rowItem)),
  );

  return { ...applyFormats(resolvedRest), rows };
};

export const resolveComponents = async (components, context) =>
  Promise.all(
    components.map(async (component) =>
      isTableComponent(component)
        ? resolveTableComponent(component, context)
        : applyFormats(await resolveEffectParams(component, context)),
    ),
  );
