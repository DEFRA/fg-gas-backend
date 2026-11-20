import Boom from "@hapi/boom";
import { ReferenceDataItem } from "./reference-data-item.js";

// The items one Reference Data Set holds, wherever they came from. Item codes
// are unique within the set, so `contains` is a membership test an answer can
// be validated against.
export class ReferenceDataSet {
  constructor({ name, items }) {
    this.name = name;
    this.items = items.map((item) => new ReferenceDataItem(item));

    this.#assertCodesUnique();
  }

  contains(code) {
    return this.items.some((item) => item.code === code);
  }

  find(code) {
    return this.items.find((item) => item.code === code);
  }

  toJSON() {
    return { name: this.name, items: this.items.map((item) => item.toJSON()) };
  }

  #assertCodesUnique() {
    const codes = new Set();

    for (const { code } of this.items) {
      if (codes.has(code)) {
        throw Boom.badRequest(
          `Reference data "${this.name}" has duplicate item code "${code}"`,
        );
      }

      codes.add(code);
    }
  }
}
