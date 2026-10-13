import Boom from "@hapi/boom";

// Administration uses the highest active published definition. Legacy is a
// fallback only when no active version exists; a known grant without either
// usable source is denied rather than treated as an unknown grant.
export class GrantAdministrationDefinition {
  static select({ activeVersion, legacyGrant, knownGrant }) {
    if (activeVersion) {
      return { kind: "published", version: activeVersion };
    }
    if (legacyGrant) {
      return { kind: "legacy", grant: legacyGrant };
    }
    if (knownGrant) {
      throw Boom.forbidden(
        "No grant definition is available for administration",
      );
    }
    throw Boom.notFound("Grant not found");
  }
}
