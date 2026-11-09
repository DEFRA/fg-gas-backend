import Boom from "@hapi/boom";

// A fixed decimal field that reads an answer can only store it if the answer's
// question caps decimal places at or below the template's. Only lone answer
// refs are checked; jsonata is left to fail at entitlement creation.
const answerReference =
  /^\$\.(?:application\.)?answers\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/;

const isFixedDecimal = (field) => !field.input && field.unitType === "decimal";

const getAnswerPath = (field) => {
  if (!isFixedDecimal(field) || typeof field.value !== "string") {
    return null;
  }

  const match = answerReference.exec(field.value);

  return match ? match[1].split(".") : null;
};

// Skips `if` (only tests) and `not` (forbids).
const getSubschemas = (schema) => [
  ...(schema.allOf ?? []),
  ...(schema.anyOf ?? []),
  ...(schema.oneOf ?? []),
  schema.then,
  schema.else,
];

const findOwnDeclarations = (schema, [name, ...rest]) => {
  const property = schema.properties?.[name];

  if (!property) {
    return [];
  }

  return rest.length === 0 ? [property] : findDeclarations(property, rest);
};

const findDeclarations = (schema, path) => {
  if (!schema || typeof schema !== "object") {
    return [];
  }

  return [
    ...findOwnDeclarations(schema, path),
    ...getSubschemas(schema).flatMap((subschema) =>
      findDeclarations(subschema, path),
    ),
  ];
};

const isCappedAt = (declaration, decimalPlaces) =>
  Number.isInteger(declaration.fgMaxDecimalPlaces) &&
  declaration.fgMaxDecimalPlaces <= decimalPlaces;

const assertFieldAnswerCapped = (phases, claimCode, name, field, path) => {
  const answer = path.join(".");
  const declarations = phases.flatMap((phase) =>
    findDeclarations(phase.questions, path),
  );

  if (declarations.length === 0) {
    throw Boom.badImplementation(
      `entitlement template "${claimCode}" field "${name}" reads answer "${answer}", which no phase's questions declare`,
    );
  }

  if (
    !declarations.every((declaration) =>
      isCappedAt(declaration, field.decimalPlaces),
    )
  ) {
    throw Boom.badImplementation(
      `entitlement template "${claimCode}" field "${name}" reads answer "${answer}", whose question must set fgMaxDecimalPlaces to at most ${field.decimalPlaces}`,
    );
  }
};

const assertTemplateAnswersCapped = (phases, template) => {
  for (const [name, field] of Object.entries(template.fields ?? {})) {
    const path = getAnswerPath(field);

    if (path) {
      assertFieldAnswerCapped(phases, template.claimCode, name, field, path);
    }
  }
};

export const assertEntitlementAnswerDecimalsCapped = (
  phases,
  entitlementTemplates,
) => {
  for (const template of entitlementTemplates) {
    assertTemplateAnswersCapped(phases, template);
  }
};
