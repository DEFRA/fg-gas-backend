import Boom from "@hapi/boom";
import { ReferenceDataItem } from "./reference-data-item.js";
import { ReferenceDataSet } from "./reference-data-set.js";

// DB Reference Data: the items GAS holds for one grant's db-sourced Reference
// Data Set. Grant Admin changes them item by item, independent of the grant's
// Config Versions.
export class DbReferenceData {
  #set;

  constructor({ grantCode, name, items = [], updatedAt = null }) {
    this.grantCode = grantCode;
    this.name = name;
    this.updatedAt = updatedAt;
    this.#set = new ReferenceDataSet({ name, items });
  }

  static empty(grantCode, name) {
    return new DbReferenceData({ grantCode, name });
  }

  static fromDocument(document) {
    return new DbReferenceData({
      grantCode: document.grantCode,
      name: document.name,
      items: document.items,
      updatedAt: document.updatedAt,
    });
  }

  get items() {
    return this.#set.items;
  }

  find(code) {
    return this.#set.find(code);
  }

  addItem(props) {
    const item = new ReferenceDataItem(props);

    if (this.#set.contains(item.code)) {
      throw Boom.conflict(
        `Reference data "${this.name}" already has an item with code "${item.code}"`,
      );
    }

    this.#replaceItems([...this.items, item]);
  }

  // An item's code is its identity, so a change keeps it and replaces only the
  // description.
  changeItem(code, { description }) {
    this.#assertHas(code);

    this.#replaceItems(
      this.items.map((item) =>
        item.code === code
          ? new ReferenceDataItem({ code, description })
          : item,
      ),
    );
  }

  removeItem(code) {
    this.#assertHas(code);

    this.#replaceItems(this.items.filter((item) => item.code !== code));
  }

  toSet() {
    return this.#set;
  }

  toDocument() {
    return {
      grantCode: this.grantCode,
      name: this.name,
      items: this.items.map((item) => item.toJSON()),
      updatedAt: this.updatedAt,
    };
  }

  toJSON() {
    return { ...this.#set.toJSON(), updatedAt: this.updatedAt };
  }

  #assertHas(code) {
    if (!this.#set.contains(code)) {
      throw Boom.notFound(
        `Reference data "${this.name}" has no item with code "${code}"`,
      );
    }
  }

  #replaceItems(items) {
    this.#set = new ReferenceDataSet({ name: this.name, items });
    this.updatedAt = new Date().toISOString();
  }
}
