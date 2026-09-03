import Boom from "@hapi/boom";
import { entitlementTemplate } from "../schemas/grant/entitlement-template.js";
import { Entitlement } from "./entitlement.js";

export const EntitlementCreationRejection = {
  WRONG_POSITION: "WRONG_POSITION",
  MATERIALISED_TEMPLATE: "MATERIALISED_TEMPLATE",
  INVALID_ENTITLEMENT_DATA: "INVALID_ENTITLEMENT_DATA",
  CAPACITY_REACHED: "CAPACITY_REACHED",
};

export class EntitlementTemplate {
  static validationSchema = entitlementTemplate;

  constructor(props) {
    const { error, value } = EntitlementTemplate.validationSchema.validate(
      props,
      { stripUnknown: true, abortEarly: false },
    );

    if (error) {
      throw Boom.badImplementation(
        `Invalid entitlement template "${props?.claimCode}": ${error.details.map((d) => d.message).join(", ")}`,
      );
    }

    const {
      claimCode,
      name,
      description,
      materialised,
      fields,
      maxEntitlements,
      availableAt,
      help,
      claim,
    } = value;

    this.claimCode = claimCode;
    this.name = name;
    this.description = description;
    this.materialised = materialised;
    this.fields = fields;
    this.maxEntitlements = maxEntitlements;
    this.availableAt = availableAt;
    this.help = help;
    this.claim = claim;
  }

  isAvailableAt(position) {
    return this.#matchesAnyPosition(this.availableAt, position);
  }

  isClaimableAt(position) {
    return this.#matchesAnyPosition(this.claim?.claimableAt ?? [], position);
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

  #matchesAnyPosition(positions, position) {
    if (!position) {
      return false;
    }

    return positions.some((declared) =>
      this.#positionMatches(declared, position),
    );
  }

  #positionMatches(declared, actual) {
    const matches = (declaredPart, actualPart) =>
      declaredPart == null || declaredPart === actualPart;

    return (
      declared.phase === actual.phase &&
      matches(declared.stage, actual.stage) &&
      matches(declared.status, actual.status)
    );
  }

  // The fields whoever creates the entitlement has to supply. The rest are
  // fixed by the definition, as literals or as jsonata expressions still to be
  // resolved against the agreement.
  inputFieldNames() {
    return Object.entries(this.fields ?? {})
      .filter(([, field]) => field.input)
      .map(([name]) => name);
  }

  #submittedDataMatches(submittedData) {
    const expected = this.inputFieldNames().sort();
    const submitted = Object.keys(submittedData ?? {}).sort();

    return (
      expected.length === submitted.length &&
      expected.every((fieldName, index) => fieldName === submitted[index])
    );
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
  }
}
