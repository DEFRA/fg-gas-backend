import Joi from "joi";

// The MongoDB driver resolves ignoreUndefined to false, so a key this template
// leaves undefined is stored as null and comes back as null on the next read.
// Every optional key therefore has to read null as "absent", or a template that
// omits one would save cleanly and then fail validation forever afterwards -
// and because findAll rehydrates every document, one such grant would take out
// the whole collection.
const absentAsNull = (schema) => schema.optional().empty(null);

export const UnitType = {
  Decimal: "decimal",
  String: "string",
};

// Where an application has to be before the template applies, addressed by part
// the same way `phases` is, so there is nothing left to parse or mis-spell. A
// part left out matches anything, which is how a template covers a whole phase
// without restating every stage and status underneath it.
//
// Only a prefix may be omitted - a status needs the stage it belongs to. Status
// codes are not unique across stages, so "this status, in any stage" would name
// a set the definition cannot see the boundaries of.
const availableAt = Joi.object({
  phase: Joi.string().required(),
  stage: absentAsNull(Joi.string()),
  status: Joi.any().when("stage", {
    is: Joi.exist(),
    then: absentAsNull(Joi.string()),
    otherwise: Joi.forbidden(),
  }),
}).label("EntitlementTemplateAvailableAt");

// Constraint keys belong to one unit type each. Carrying `decimalPlaces` on a
// string field (or `maxLength` on a decimal) is a definition mistake that would
// otherwise sit there being quietly ignored by whoever renders the form.
const onlyFor = (unitType, schema) =>
  Joi.any().when("unitType", {
    is: unitType,
    then: schema,
    otherwise: Joi.forbidden(),
  });

// A field is either collected from whoever creates the entitlement - so it
// needs a label to render against - or fixed by the definition, in which case
// it needs the value itself. `value` may be a literal or a
// "jsonata: <expression>" resolved against the agreement when the entitlement
// is created; it stays an opaque string here, because a grant definition on its
// own has nothing to resolve it against.
const field = Joi.object({
  input: Joi.boolean().required(),

  label: Joi.any().when("input", {
    is: true,
    then: Joi.string().required(),
    otherwise: Joi.forbidden(),
  }),

  value: Joi.any().when("input", {
    is: false,
    then: Joi.alternatives()
      .try(Joi.string(), Joi.number(), Joi.boolean())
      .required(),
    otherwise: Joi.forbidden(),
  }),

  unitType: Joi.string()
    .valid(...Object.values(UnitType))
    .required(),

  decimalPlaces: onlyFor(
    UnitType.Decimal,
    Joi.number().integer().min(0).required(),
  ),
  unit: onlyFor(UnitType.Decimal, Joi.string().required()),
  // null is how the definition spells "no bound"; omitting the key means the
  // same thing. Bounds stay optional even under the create/replace request
  // schemas, which apply `presence: "required"` to everything they reach.
  minValue: onlyFor(UnitType.Decimal, Joi.number().allow(null).optional()),
  maxValue: onlyFor(UnitType.Decimal, Joi.number().allow(null).optional()),

  minLength: onlyFor(
    UnitType.String,
    Joi.number().integer().min(0).allow(null).optional(),
  ),
  maxLength: onlyFor(
    UnitType.String,
    Joi.number().integer().min(1).allow(null).optional(),
  ),
}).label("EntitlementTemplateField");

// Claiming happens after the entitlement exists and is not consulted to create
// one, so the whole block is optional and every rule inside it has a default.
const claim = Joi.object({
  limits: Joi.object({
    // How many claims may be made against a single entitlement, as opposed to
    // maxEntitlements, which caps how many entitlements exist to claim against.
    maximumClaims: Joi.number().integer().min(1).default(1).optional(),
    allowsPartialClaims: Joi.boolean().default(false).optional(),
  })
    .default()
    .optional(),
  requiresApproval: Joi.boolean().default(false).optional(),
  requiresEvidence: Joi.boolean().default(false).optional(),
}).label("EntitlementTemplateClaim");

// A materialised entitlement is projected from the application's position and
// what has already been claimed, so there is nothing for anyone to type in and
// nothing to store. Switching materialisation off is what makes an entitlement
// real, and the only reason to do that is a value the system cannot derive -
// PA3's assessed hectares arrive from the Forestry Commission. A persisted
// template that collects nothing could only ever create empty rows.
const assertPersistedTemplateCollectsInput = (template, helpers) => {
  if (template.materialised) {
    return template;
  }

  const collectsInput = Object.values(template.fields ?? {}).some(
    (templateField) => templateField.input,
  );

  return collectsInput
    ? template
    : helpers.message({
        custom: `"fields" must define at least one field with "input" true when "materialised" is false`,
      });
};

export const entitlementTemplate = Joi.object({
  claimCode: Joi.string().required(),
  name: Joi.string().required(),
  description: absentAsNull(Joi.string()),

  // Materialising is the ordinary case, so it is what you get by saying
  // nothing.
  materialised: Joi.boolean().default(true).optional(),

  // Absent for a materialised template: its values come from the agreement
  // rather than the definition.
  fields: absentAsNull(Joi.object().pattern(Joi.string(), field).min(1)),

  maxEntitlements: Joi.number().integer().min(1).default(1).optional(),

  availableAt: availableAt.required(),

  claim: absentAsNull(claim),
})
  .custom(assertPersistedTemplateCollectsInput)
  .label("EntitlementTemplate");

export const entitlementTemplates = Joi.array()
  .items(entitlementTemplate)
  .unique("claimCode")
  .label("EntitlementTemplates");
