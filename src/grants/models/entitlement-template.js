import Boom from "@hapi/boom";
import { entitlementTemplate } from "../schemas/grant/entitlement-template.js";
import { Entitlement } from "./entitlement.js";
import { PositionScope } from "./position-scope.js";

export const EntitlementCreationRejection = {
  WRONG_POSITION: "WRONG_POSITION",
  MATERIALISED_TEMPLATE: "MATERIALISED_TEMPLATE",
  INVALID_ENTITLEMENT_DATA: "INVALID_ENTITLEMENT_DATA",
  CAPACITY_REACHED: "CAPACITY_REACHED",
};

const toPositionScopes = (positions) =>
  positions.map((position) => new PositionScope(position));

const withClaimablePositions = (claim) =>
  claim?.claimableAt
    ? { ...claim, claimableAt: toPositionScopes(claim.claimableAt) }
    : claim;

export class EntitlementTemplate {
  static validationSchema = entitlementTemplate;

  constructor({
    claimCode,
    name,
    description,
    materialised,
    fields,
    maxEntitlements,
    availableAt,
    help,
    claim,
  }) {
    this.claimCode = claimCode;
    this.name = name;
    this.description = description;
    this.materialised = materialised;
    this.fields = fields;
    this.maxEntitlements = maxEntitlements;
    this.availableAt = availableAt;
    this.help = help;
    this.claim = claim;

    this.#assertPositionScopes("availableAt", availableAt);
    this.#assertPositionScopes("claim.claimableAt", claim?.claimableAt);
  }

  #assertPositionScopes(field, scopes) {
    if (!PositionScope.areAll(scopes)) {
      throw Boom.badImplementation(
        `Invalid entitlement template "${this.claimCode}": "${field}" must contain only PositionScopes`,
      );
    }
  }

  static fromDefinition(definition) {
    const { error, value } = EntitlementTemplate.validationSchema.validate(
      definition,
      { stripUnknown: true, abortEarly: false },
    );

    if (error) {
      throw Boom.badImplementation(
        `Invalid entitlement template "${definition?.claimCode}": ${error.details.map((d) => d.message).join(", ")}`,
      );
    }

    return new EntitlementTemplate({
      ...value,
      availableAt: toPositionScopes(value.availableAt),
      claim: withClaimablePositions(value.claim),
    });
  }

  isAvailableAt(position) {
    return PositionScope.anyCovers(this.availableAt, position);
  }

  isClaimableAt(position) {
    return PositionScope.anyCovers(this.claim?.claimableAt ?? [], position);
  }

  assessEntitlementCreation(position, existing, submittedData) {
    const instances = existing.filter(
      (entitlement) => entitlement.claimCode === this.claimCode,
    );
    const reason = this.#creationRejection(position, instances, submittedData);

    if (reason) {
      return { allowed: false, reason };
    }

    return {
      allowed: true,
      nextInstanceNumber: Entitlement.nextInstanceNumber(instances),
    };
  }

  // The fields whoever creates the entitlement has to supply. The rest are
  // fixed by the definition, as literals or as jsonata expressions still to be
  // resolved against the agreement.
  inputFieldNames() {
    return Object.entries(this.fields ?? {})
      .filter(([, field]) => field.input)
      .map(([name]) => name);
  }

  invalidInputFieldNames(submittedData) {
    const submitted = Object.keys(submittedData ?? {});

    return this.inputFieldNames().filter(
      (fieldName) =>
        submitted.includes(fieldName) &&
        !this.#submittedValueMatches(
          this.fields[fieldName],
          submittedData[fieldName]?.value,
        ),
    );
  }

  hasValidInputData(submittedData) {
    return this.#submittedDataMatches(submittedData);
  }

  #submittedDataMatches(submittedData) {
    const expected = this.inputFieldNames();
    const submitted = Object.keys(submittedData ?? {});

    return (
      expected.length === submitted.length &&
      expected.every((fieldName) => submitted.includes(fieldName)) &&
      this.invalidInputFieldNames(submittedData).length === 0
    );
  }

  #submittedValueMatches(field, value) {
    return field.unitType === "decimal"
      ? this.#decimalValueMatches(field, value)
      : this.#stringValueMatches(field, value);
  }

  #decimalValueMatches(field, value) {
    return (
      this.#isFiniteNumber(value) &&
      this.#withinRange(value, field.minValue, field.maxValue) &&
      this.#decimalPlaces(value) <= field.decimalPlaces
    );
  }

  #stringValueMatches(field, value) {
    return (
      typeof value === "string" &&
      this.#withinRange(value.length, field.minLength, field.maxLength)
    );
  }

  #isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  #withinRange(value, minimum, maximum) {
    return (
      this.#meetsMinimum(value, minimum) && this.#meetsMaximum(value, maximum)
    );
  }

  #meetsMinimum(value, minimum) {
    return minimum == null || value >= minimum;
  }

  #meetsMaximum(value, maximum) {
    return maximum == null || value <= maximum;
  }

  #decimalPlaces(value) {
    const [coefficient, exponent] = value.toString().toLowerCase().split("e");
    const decimals = (coefficient.split(".")[1] ?? "").length;

    return Math.max(0, decimals - Number(exponent ?? 0));
  }

  #creationRejection(position, instances, submittedData) {
    if (!this.isAvailableAt(position)) {
      return EntitlementCreationRejection.WRONG_POSITION;
    }

    return this.#templateCreationRejection(instances, submittedData);
  }

  #templateCreationRejection(instances, submittedData) {
    if (this.materialised) {
      return EntitlementCreationRejection.MATERIALISED_TEMPLATE;
    }

    if (!this.#submittedDataMatches(submittedData)) {
      return EntitlementCreationRejection.INVALID_ENTITLEMENT_DATA;
    }

    if (instances.length >= this.maxEntitlements) {
      return EntitlementCreationRejection.CAPACITY_REACHED;
    }

    return undefined;
  }
}
