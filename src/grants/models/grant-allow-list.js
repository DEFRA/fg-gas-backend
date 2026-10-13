import Boom from "@hapi/boom";

const patterns = {
  sbi: /^\d{9}$/,
  crn: /^\d{10}$/,
};

const labels = {
  sbi: "SBI",
  crn: "CRN",
};

const lengths = {
  sbi: 9,
  crn: 10,
};

const refusal = (message, errorCode) => {
  const error = Boom.badRequest(message);
  error.output.payload.errorCode = errorCode;
  return error;
};

const malformedStoredState = () => {
  const error = Boom.badImplementation("Stored grant allow list is malformed");
  error.output.payload.errorCode = "MALFORMED_ALLOW_LIST";
  return error;
};

const normalize = (values) =>
  Array.isArray(values)
    ? values
        .map((value) => (typeof value === "string" ? value.trim() : value))
        .filter((value) => value !== "")
    : values;

const isInvalidIdentifier = (kind) => (value) =>
  typeof value !== "string" || !patterns[kind].test(value);

const hasInvalidIdentifier = (kind, values) =>
  !Array.isArray(values) || values.some(isInvalidIdentifier(kind));

const validate = (kind, values) => {
  if (hasInvalidIdentifier(kind, values)) {
    throw refusal(
      `Each ${labels[kind]} must be exactly ${lengths[kind]} digits`,
      "INVALID_ALLOW_LIST_IDENTIFIER",
    );
  }

  if (new Set(values).size !== values.length) {
    throw refusal(
      `Each ${labels[kind]} must be listed only once`,
      "DUPLICATE_ALLOW_LIST_IDENTIFIER",
    );
  }

  return values;
};

export class GrantAllowList {
  constructor({ grantCode, global }) {
    if (!global || !Array.isArray(global.sbi) || !Array.isArray(global.crn)) {
      throw malformedStoredState();
    }

    this.grantCode = grantCode;
    this.global = { sbi: [], crn: [] };
    this.replaceGlobal(global);
  }

  static unrestricted(grantCode) {
    return new GrantAllowList({
      grantCode,
      global: { sbi: [], crn: [] },
    });
  }

  static fromDocument(document) {
    try {
      return new GrantAllowList(document);
    } catch {
      throw malformedStoredState();
    }
  }

  replaceGlobal({ sbi, crn }) {
    const replacement = {
      sbi: validate("sbi", normalize(sbi)),
      crn: validate("crn", normalize(crn)),
    };

    this.global = replacement;
  }

  toJSON() {
    return {
      grantCode: this.grantCode,
      global: {
        sbi: [...this.global.sbi],
        crn: [...this.global.crn],
      },
    };
  }

  toDocument() {
    return this.toJSON();
  }
}
