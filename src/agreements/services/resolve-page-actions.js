const actionHref = (agreementNumber, action) =>
  `/agreements/${agreementNumber}/actions/${action}`;

const orEmpty = (value) => value ?? [];

const resolveForm = (value, context) => {
  const { action, ...form } = value;

  return {
    ...form,
    components: resolveComponentActions(form.components, {
      ...context,
      withinForm: true,
    }),
    method: "POST",
    formAction: actionHref(context.agreementNumber, action),
    hiddenFields: orEmpty(form.hiddenFields),
  };
};

const resolveButton = (value, { agreementNumber, withinForm }) => {
  const { action, ...button } = value;

  return withinForm
    ? { ...button, submit: true }
    : { ...button, href: actionHref(agreementNumber, action) };
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
) => {
  const context = { agreementNumber: agreement.agreementNumber };
  const resolve = (value) => resolveComponentActions(value, context);

  return {
    components: resolve(components),
    sections: sections.map((section) => ({
      ...section,
      components: resolve(section.components),
    })),
  };
};
