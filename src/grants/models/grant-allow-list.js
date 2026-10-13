import Boom from "@hapi/boom";

const patterns = {
  sbi: /^\d{9}$/,
  crn: /^\d{10}$/,
};

const satisfiesRestriction = (identifiers, identifier) =>
  identifiers.length === 0 ||
  (identifier !== "" && identifiers.includes(identifier));

const hasWrongGrantOwner = (grantCode, grant, storedList) =>
  grant.code !== grantCode ||
  (storedList && storedList.grantCode !== grantCode);

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

const hasDuplicateIdentifier = (values) =>
  Array.isArray(values) && new Set(values).size !== values.length;

const hasMalformedStoredIdentifiers = (kind, values) =>
  hasInvalidIdentifier(kind, values) || hasDuplicateIdentifier(values);

const hasMalformedStoredGlobal = (global) =>
  !global ||
  hasMalformedStoredIdentifiers("sbi", global.sbi) ||
  hasMalformedStoredIdentifiers("crn", global.crn);

const hasMalformedStoredDocument = (document) =>
  typeof document?.grantCode !== "string" ||
  document.grantCode.length === 0 ||
  hasMalformedStoredGlobal(document.global);

// Distinct values, in first-seen order, so detail reported to the caller is
// deterministic rather than depending on Set iteration quirks.
const distinct = (values) => [...new Set(values)];

const invalidValuesIn = (kind, values) =>
  Array.isArray(values)
    ? distinct(values.filter(isInvalidIdentifier(kind)))
    : [];

const duplicateValuesIn = (values) => {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const duplicates = new Set();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }

  return [...duplicates];
};

// Independent of validity: a value that is both the wrong shape and repeated
// is reported as both, matching how each submitted line is judged on its own.
// Internal only - never handed to a caller directly. toValidationFailureDetails
// below is the seam that crosses the boundary, the same role toJSON plays for
// GrantAllowList itself, so this can change shape without silently changing
// the wire contract.
const identifierProblemsIn = (kind, values) => ({
  invalid: invalidValuesIn(kind, values),
  duplicate: duplicateValuesIn(values),
});

const hasProblems = ({ invalid, duplicate }) =>
  invalid.length > 0 || duplicate.length > 0;

// The public error contract for a refused replacement.
const toValidationFailureDetails = (problems) => ({
  sbi: { invalid: problems.sbi.invalid, duplicate: problems.sbi.duplicate },
  crn: { invalid: problems.crn.invalid, duplicate: problems.crn.duplicate },
});

const validationFailure = (problems) => {
  const error = Boom.badRequest("The allow list contains invalid entries");
  error.output.payload.errorCode = "ALLOW_LIST_VALIDATION_FAILED";
  error.output.payload.details = toValidationFailureDetails(problems);
  return error;
};

// Reports every problem across both lists in one response, rather than
// stopping at the first kind that fails, so a BFF caller never has to probe
// twice to learn what else is wrong with a submission.
const validate = (global) => {
  const problems = {
    sbi: identifierProblemsIn("sbi", global.sbi),
    crn: identifierProblemsIn("crn", global.crn),
  };

  if (hasProblems(problems.sbi) || hasProblems(problems.crn)) {
    throw validationFailure(problems);
  }

  return global;
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

  static forGrant({ grantCode, grant, storedList }) {
    if (!grant) {
      throw Boom.notFound(`Grant with code "${grantCode}" not found`);
    }

    if (hasWrongGrantOwner(grantCode, grant, storedList)) {
      throw malformedStoredState();
    }

    return storedList ?? GrantAllowList.unrestricted(grantCode);
  }

  static fromDocument(document) {
    try {
      if (hasMalformedStoredDocument(document)) {
        throw malformedStoredState();
      }

      return new GrantAllowList(document);
    } catch {
      throw malformedStoredState();
    }
  }

  replaceGlobal(global) {
    if (!global || !Array.isArray(global.sbi) || !Array.isArray(global.crn)) {
      const error = Boom.badRequest(
        "Both SBI and CRN collections must be arrays",
      );
      error.output.payload.errorCode = "ALLOW_LIST_VALIDATION_FAILED";
      throw error;
    }

    this.global = validate({
      sbi: normalize(global.sbi),
      crn: normalize(global.crn),
    });
  }

  allows({ sbi, crn }) {
    const sbiOk = satisfiesRestriction(this.global.sbi, sbi);
    const crnOk = satisfiesRestriction(this.global.crn, crn);
    return sbiOk && crnOk;
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
