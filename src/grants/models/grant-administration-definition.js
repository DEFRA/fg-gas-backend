import Boom from "@hapi/boom";

// Administration uses the highest active published definition. A grant with
// no active version has nothing to administer against.
export class GrantAdministrationDefinition {
  static select({ activeVersion }) {
    if (activeVersion) {
      return { kind: "published", version: activeVersion };
    }
    throw Boom.notFound("Grant not found");
  }
}
