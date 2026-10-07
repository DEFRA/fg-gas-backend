import Boom from "@hapi/boom";

// The errorCodes callers read. Kept apart from domain reasons such as
// "EntitlementCreationRejection" even where the spelling matches so a domain
// rename cannot change the contract unexpectedly.
export const errorCodes = {
  APPLICATION_NOT_FOUND: "APPLICATION_NOT_FOUND",
  CONFIGURATION_CHANGED: "CONFIGURATION_CHANGED",
  ENTITLEMENT_CLAIMED: "ENTITLEMENT_CLAIMED",
  ENTITLEMENT_DATA_UNRESOLVED: "ENTITLEMENT_DATA_UNRESOLVED",
  ENTITLEMENT_LIMIT_EXCEEDED: "ENTITLEMENT_LIMIT_EXCEEDED",
  ENTITLEMENT_NOT_FOUND: "ENTITLEMENT_NOT_FOUND",
  INVALID_CLAIM_CODE: "INVALID_CLAIM_CODE",
  INVALID_ENTITLEMENT_DATA: "INVALID_ENTITLEMENT_DATA",
};

export const withErrorCode = (boom, errorCode) => {
  boom.output.payload.errorCode = errorCode;
  return boom;
};

export const applicationNotFound = ({ code, clientRef }) =>
  withErrorCode(
    Boom.notFound(
      `No matching application found for clientRef '${clientRef}' and grantCode '${code}'.`,
    ),
    errorCodes.APPLICATION_NOT_FOUND,
  );

export const invalidClaimCode = ({ code, clientRef, claimCode, grant }) => {
  if (!grant.findEntitlementTemplate(claimCode)) {
    return withErrorCode(
      Boom.badData(
        `Claim code '${claimCode}' is not defined for grant code '${code}'.`,
      ),
      errorCodes.INVALID_CLAIM_CODE,
    );
  }

  return withErrorCode(
    Boom.badData(
      `Claim code '${claimCode}' is not available for application '${clientRef}'.`,
    ),
    errorCodes.INVALID_CLAIM_CODE,
  );
};

const byName = (a, b) => a.localeCompare(b);

const invalidValuesMessage = (fieldNames) =>
  fieldNames.length === 1
    ? `Field '${fieldNames[0]}' has an invalid value`
    : `Fields '${fieldNames.join("', '")}' have invalid values`;

export const invalidDataMessage = ({ template, data, claimCode }) => {
  const expected = template.inputFieldNames().sort(byName);
  const submitted = Object.keys(data).sort(byName);
  const missing = expected.filter((name) => !submitted.includes(name));
  const unexpected = submitted.filter((name) => !expected.includes(name));
  const problems = [
    missing.length > 0 && `missing fields: ${missing.join(", ")}`,
    unexpected.length > 0 && `unexpected fields: ${unexpected.join(", ")}`,
  ].filter(Boolean);
  const invalidFields = template.invalidInputFieldNames(data);
  const detail = problems.join("; ") || invalidValuesMessage(invalidFields);

  return `Entitlement data for claim code '${claimCode}' does not match the template: ${detail}.`;
};

export const entitlementNotFound = ({ clientRef, entitlementId }) =>
  withErrorCode(
    Boom.notFound(
      `No entitlement '${entitlementId}' found for application '${clientRef}'.`,
    ),
    errorCodes.ENTITLEMENT_NOT_FOUND,
  );

export const entitlementClaimed = ({ name }) =>
  withErrorCode(
    Boom.conflict(`${name} has a claim against it and cannot be changed.`),
    errorCodes.ENTITLEMENT_CLAIMED,
  );

export const configurationChanged = ({ code }) =>
  withErrorCode(
    Boom.conflict(
      `Grant configuration for '${code}' changed while updating the entitlement. Try again.`,
    ),
    errorCodes.CONFIGURATION_CHANGED,
  );

export const invalidUpdateData = ({ template, data, claimCode }) =>
  withErrorCode(
    Boom.badData(invalidDataMessage({ template, data, claimCode })),
    errorCodes.INVALID_ENTITLEMENT_DATA,
  );
