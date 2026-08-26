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
    if (!position) {
      return false;
    }

    const matches = (declared, actual) =>
      declared == null || declared === actual;
    const { phase, stage, status } = this.availableAt;

    return (
      phase === position.phase &&
      matches(stage, position.stage) &&
      matches(status, position.status)
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
}
