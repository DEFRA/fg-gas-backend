import Boom from "@hapi/boom";
import { referenceDataItem } from "../schemas/grant/reference-data.js";

// One allowed value of a Reference Data Set.
export class ReferenceDataItem {
  static validationSchema = referenceDataItem;

  constructor(props) {
    const { error, value } = ReferenceDataItem.validationSchema.validate(
      props,
      { stripUnknown: true },
    );

    if (error) {
      throw Boom.badRequest(
        `Invalid reference data item: ${error.details.map((d) => d.message).join(", ")}`,
      );
    }

    this.code = value.code;
    this.description = value.description;
  }

  toJSON() {
    return { code: this.code, description: this.description };
  }
}
