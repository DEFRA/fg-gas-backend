const REFERENCE_FIELDS = ["agreementNumber", "code", "clientRef", "sbi"];

const requireNonEmptyString = (name, value) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(
      `Agreement Reference ${name} must be a non-empty string`,
    );
  }

  return value;
};

export class AgreementReference {
  constructor({ agreementNumber, code, clientRef, sbi }) {
    this.agreementNumber = requireNonEmptyString(
      "agreementNumber",
      agreementNumber,
    );
    this.code = requireNonEmptyString("code", code);
    this.clientRef = requireNonEmptyString("clientRef", clientRef);
    this.sbi = requireNonEmptyString("sbi", sbi);

    Object.freeze(this);
  }

  equals(other) {
    return (
      other instanceof AgreementReference &&
      REFERENCE_FIELDS.every((field) => this[field] === other[field])
    );
  }
}
