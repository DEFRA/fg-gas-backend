import Boom from "@hapi/boom";
import { validateProcessMapping } from "../../common/mapping/resolve-process-mapping.js";
import { ReferenceDataSet } from "./reference-data-set.js";

export const ReferenceDataSourceType = Object.freeze({
  Inline: "inline",
  Db: "db",
  Endpoint: "endpoint",
});

// A Reference Data Set a grant declares: its name and where its items come
// from. Inline items and an endpoint's output Mapping are checked here, so a
// definition with bad ones is refused before its version is recorded.
export class ReferenceDataDeclaration {
  constructor({ name, source }) {
    this.name = name;
    this.source = source;

    if (this.type === ReferenceDataSourceType.Inline) {
      this.inlineSet = new ReferenceDataSet({ name, items: source.items });
    }

    if (this.type === ReferenceDataSourceType.Endpoint) {
      this.#assertOutputMappingValid();
    }
  }

  get type() {
    return this.source.type;
  }

  get isHeldInDb() {
    return this.type === ReferenceDataSourceType.Db;
  }

  toJSON() {
    return { name: this.name, source: this.source };
  }

  #assertOutputMappingValid() {
    try {
      validateProcessMapping(this.source.output.items);
    } catch (error) {
      throw Boom.badImplementation(
        `Reference data "${this.name}" output items mapping is invalid: ${error.message}`,
      );
    }
  }
}
