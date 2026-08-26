const actionHref = (agreementNumber, action) =>
  `/agreements/${agreementNumber}/actions/${action}`;

const orEmpty = (value) => value ?? [];

const resolveForm = (value, context) => {
  const { action, ...form } = value;
  const resolvedAction = context.resolveAction(action);

  return {
    ...form,
    components: resolveComponentActions(form.components, {
      ...context,
      withinForm: true,
    }),
    method: "POST",
    formAction: actionHref(context.agreementNumber, action),
    hiddenFields: orEmpty(form.hiddenFields),
    submissionRequirements: resolvedAction.submissionRequirements,
  };
};

const resolveButton = (value, context) => {
  const { action, ...button } = value;

  if (context.withinForm) {
    return { ...button, submit: true };
  }

  return { ...button, href: actionHref(context.agreementNumber, action) };
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

export const resolvePageActions = (
  { components, sections = [] },
  agreement,
  agreementDefinition,
) => {
  const context = {
    agreementNumber: agreement.agreementNumber,
    resolveAction: (action) =>
      agreementDefinition.resolveAction({ state: agreement.state, action }),
  };
  const resolve = (value) => resolveComponentActions(value, context);

  return {
    components: resolve(components),
    sections: sections.map((section) => ({
      ...section,
      components: resolve(section.components),
    })),
  };
};
