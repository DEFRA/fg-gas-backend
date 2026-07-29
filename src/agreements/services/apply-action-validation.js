import { matchesConfiguredValue } from "../../common/matches-configured-value.js";

const toErrorSummary = ({ href, message }) => ({ href, text: message });

const applyCheckboxItem = (item, submittedValue) =>
  Object.hasOwn(item, "value") && item.value !== undefined
    ? {
        ...item,
        checked: matchesConfiguredValue(submittedValue, item.value),
      }
    : item;

const applyCheckboxValues = (component, submittedValue) => ({
  ...component,
  items: component.items.map((item) => applyCheckboxItem(item, submittedValue)),
});

const isNamedComponent = (component) =>
  typeof component.component === "string" && typeof component.name === "string";

const applySubmittedValue = (component, values) => {
  if (component.component === "checkboxes") {
    return applyCheckboxValues(component, values[component.name]);
  }
  if (Object.hasOwn(values, component.name)) {
    return { ...component, value: values[component.name] };
  }
  return component;
};

const applyComponentState = (component, values, errorsByName) => {
  if (!isNamedComponent(component)) {
    return component;
  }

  const withValues = applySubmittedValue(component, values);
  const error = errorsByName.get(component.name);

  return error
    ? { ...withValues, errorMessage: { text: error.message } }
    : withValues;
};

const applyComponentTree = (value, values, errorsByName) => {
  if (Array.isArray(value)) {
    return value.map((item) => applyComponentTree(item, values, errorsByName));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const resolved = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      applyComponentTree(item, values, errorsByName),
    ]),
  );

  return applyComponentState(resolved, values, errorsByName);
};

export const applyActionValidation = ({ pageModel, values, errors }) => {
  const errorsByName = new Map(errors.map((error) => [error.name, error]));

  return {
    ...pageModel,
    components: applyComponentTree(pageModel.components, values, errorsByName),
    values,
    errors: errors.map(toErrorSummary),
  };
};
