const allowedGridWidths = new Set(["two-thirds", "full"]);

const invalidTree = () => {
  throw new Error("Agreement page must use an explicit component tree");
};

const invalidBindings = () => {
  throw new Error("Invalid agreement action bindings");
};

const isAllowedWidth = ({ width }) =>
  width === undefined || allowedGridWidths.has(width);

const hasComponents = (value) =>
  Array.isArray(value.components) && value.components.length > 0;

const isComponent = (value, component) => value?.component === component;

const isExplicitColumn = (column) =>
  isComponent(column, "grid-column") &&
  isAllowedWidth(column) &&
  hasComponents(column);

const isExplicitRow = (row) =>
  isComponent(row, "grid-row") &&
  hasComponents(row) &&
  row.components.every(isExplicitColumn);

const assertExplicitComponentTree = (components) => {
  if (!Array.isArray(components) || !components.every(isExplicitRow)) {
    invalidTree();
  }
};

const isValidAction = (action, actionsByName) => {
  if (typeof action.name !== "string" || actionsByName.has(action.name)) {
    return false;
  }

  return typeof action.href === "string" && action.href.length > 0;
};

const indexActions = (actions) => {
  const actionsByName = new Map();

  for (const action of actions) {
    if (!isValidAction(action, actionsByName)) {
      invalidBindings();
    }

    actionsByName.set(action.name, action);
  }

  return actionsByName;
};

const orEmpty = (value) => value ?? [];

const requirePostFormAction = (action, context) => {
  if (!action || action.method !== "POST") {
    invalidBindings();
  }

  if (context.enclosingFormActionId !== undefined) {
    invalidBindings();
  }
};

const resolveForm = (value, context) => {
  const { actionId, ...form } = value;
  const action = context.actionsByName.get(actionId);
  requirePostFormAction(action, context);
  context.references.get(actionId).forms += 1;

  return {
    ...form,
    components: resolveComponentActions(orEmpty(form.components), {
      ...context,
      enclosingFormActionId: actionId,
    }),
    method: "POST",
    formAction: action.href,
    hiddenFields: orEmpty(action.fields),
  };
};

const isWrongPostForm = (postAction, actionId, context) =>
  postAction && context.enclosingFormActionId !== actionId;

const requireButtonPlacement = (action, actionId, context) => {
  if (!action) {
    invalidBindings();
  }

  const insideForm = context.enclosingFormActionId !== undefined;
  const postAction = action.method === "POST";
  if (postAction !== insideForm) {
    invalidBindings();
  }

  if (isWrongPostForm(postAction, actionId, context)) {
    invalidBindings();
  }
};

const resolveButtonClasses = (button, action) => {
  const classes = button.classes ?? action.classes;
  return classes === undefined ? {} : { classes };
};

const resolveButtonTarget = (action) =>
  action.method === "POST" ? { submit: true } : { href: action.href };

const resolveButton = (value, context) => {
  const { actionId, ...button } = value;
  const action = context.actionsByName.get(actionId);
  requireButtonPlacement(action, actionId, context);
  context.references.get(actionId).buttons += 1;

  return {
    ...button,
    text: action.text,
    ...resolveButtonClasses(button, action),
    ...resolveButtonTarget(action),
  };
};

const resolveObjectActions = (value, context) => {
  if (value.component === "form") {
    return resolveForm(value, context);
  }

  if (value.component === "button") {
    return resolveButton(value, context);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      resolveComponentActions(item, context),
    ]),
  );
};

const resolveComponentActions = (value, context) => {
  if (Array.isArray(value)) {
    return value.map((item) => resolveComponentActions(item, context));
  }

  return value === null || typeof value !== "object"
    ? value
    : resolveObjectActions(value, context);
};

const expectedFormCount = (action) => (action.method === "POST" ? 1 : 0);

const hasExpectedReferences = (reference, action) =>
  reference.buttons === 1 && reference.forms === expectedFormCount(action);

const validateReferences = (actions, references) => {
  for (const action of actions) {
    if (!hasExpectedReferences(references.get(action.name), action)) {
      invalidBindings();
    }
  }
};

export const resolvePageActions = ({ components, sections = [], actions }) => {
  assertExplicitComponentTree(components);
  sections.forEach((section) =>
    assertExplicitComponentTree(section.components),
  );

  const actionsByName = indexActions(actions);
  const references = new Map(
    actions.map(({ name }) => [name, { buttons: 0, forms: 0 }]),
  );
  const resolve = (value) =>
    resolveComponentActions(value, { actionsByName, references });
  const resolvedComponents = resolve(components);
  const resolvedSections = sections.map((section) => ({
    ...section,
    components: resolve(section.components),
  }));

  validateReferences(actions, references);

  return { components: resolvedComponents, sections: resolvedSections };
};
