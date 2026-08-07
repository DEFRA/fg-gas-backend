import Boom from "@hapi/boom";
import { entitlementTemplate } from "../schemas/grant/entitlement-template.js";

export class EntitlementTemplate {
  static validationSchema = entitlementTemplate;

  constructor(props) {
    const { error, value } = EntitlementTemplate.validationSchema.validate(
      props,
      { stripUnknown: true, abortEarly: false },
    );

    if (error) {
      throw Boom.badImplementation(
        `Invalid entitlement template "${props?.code}": ${error.details.map((d) => d.message).join(", ")}`,
      );
    }

    const { code, name, description, appliesTo, limit, creation, claim } =
      value;

    this.code = code;
    this.name = name;
    this.description = description;
    this.appliesTo = appliesTo;
    this.limit = limit;
    this.creation = creation;
    this.claim = claim;
  }

  // Undefined when creating the entitlement does not move the application.
  get creationTargetPosition() {
    return this.creation.onCreated?.targetPosition;
  }

  // Undefined when the template has no claim block, or claiming does not move
  // the application.
  get claimTargetPosition() {
    return this.claim?.onCreated?.targetPosition;
  }

  isAvailableForCreationAt(position) {
    return this.creation.availableAt.includes(position);
  }

  isAvailableForClaimAt(position) {
    return this.claim?.availableAt?.includes(position) ?? false;
  }

  // Every position referenced by this template that must resolve to a real
  // phase:stage:status in the owning grant's `phases`. Optional blocks
  // contribute nothing rather than an undefined entry.
  referencedPositions() {
    return [
      ...this.creation.availableAt,
      this.creationTargetPosition,
      ...(this.claim?.availableAt ?? []),
      this.claimTargetPosition,
    ].filter(Boolean);
  }
}
