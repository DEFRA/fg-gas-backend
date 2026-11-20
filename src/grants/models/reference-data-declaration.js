import { assertOutputMappingValid } from "./output-mapping.js";
import { ReferenceDataSet } from "./reference-data-set.js";

export const ReferenceDataSourceType = Object.freeze({
  Inline: "inline",
  Db: "db",
  Endpoint: "endpoint",
});

// A Reference Data Set a grant declares: its name and where its items come
// from. Inline items and an endpoint list's own output Mapping are checked
// here; that an endpoint list names a real endpoint is the Grant's to check.
export class ReferenceDataDeclaration {
  constructor({ name, source }) {
    this.name = name;
    this.source = source;

    if (this.type === ReferenceDataSourceType.Inline) {
      this.inlineSet = new ReferenceDataSet({ name, items: source.items });
    }

    if (this.type === ReferenceDataSourceType.Endpoint && source.output) {
      assertOutputMappingValid(`Reference data "${name}"`, source.output);
    }
  }

  get type() {
    return this.source.type;
  }

  get isHeldInDb() {
    return this.type === ReferenceDataSourceType.Db;
  }

  get isFromEndpoint() {
    return this.type === ReferenceDataSourceType.Endpoint;
  }

  get endpointCode() {
    return this.source.endpoint;
  }

  toJSON() {
    return { name: this.name, source: this.source };
  }
}
