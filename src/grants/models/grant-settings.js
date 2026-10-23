import Boom from "@hapi/boom";

const hasGrantCode = (document) =>
  typeof document.grantCode === "string" &&
  document.grantCode.trim().length > 0;

export class GrantSettings {
  constructor({ grantCode, open }) {
    this.grantCode = grantCode;
    this.setOpen(open);
  }

  static fromDocument(document) {
    if (
      !document ||
      !hasGrantCode(document) ||
      typeof document.open !== "boolean"
    ) {
      const error = Boom.internal("Stored grant settings are malformed");
      error.output.payload.errorCode = "MALFORMED_GRANT_SETTINGS";
      throw error;
    }
    return new GrantSettings(document);
  }

  static closed(grantCode) {
    return new GrantSettings({ grantCode, open: false });
  }

  toDocument() {
    return { grantCode: this.grantCode, open: this.open };
  }

  isOpen() {
    return this.open;
  }

  setOpen(open) {
    if (typeof open !== "boolean") {
      const error = Boom.badRequest("Grant open status must be a boolean");
      error.output.payload.errorCode = "GRANT_SETTINGS_VALIDATION_FAILED";
      throw error;
    }
    this.open = open;
  }
}
