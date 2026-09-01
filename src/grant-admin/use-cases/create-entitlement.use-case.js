import Boom from "@hapi/boom";
import { findAgreementBySourceIdentity } from "../../agreements/repositories/agreement.repository.js";
import { resolveRefs } from "../../common/resolve-refs.js";
import { Entitlement } from "../models/entitlement.js";
import { insertEntitlement } from "../repositories/entitlement.repository.js";
import { toApplicationContext } from "../services/application-context.js";
import { resolveEntitlementsUseCase } from "./resolve-entitlements.use-case.js";

const HTTP_STATUS_NOT_FOUND = 404;

const withErrorCode = (boom, errorCode) => {
  boom.output.payload.errorCode = errorCode;
  return boom;
};

const isApplicationNotFound = (error) =>
  error.isBoom &&
  error.output.statusCode === HTTP_STATUS_NOT_FOUND &&
  error.message.startsWith("Application");

const resolveOrMapNotFound = async ({ code, clientRef }) => {
  try {
    return await resolveEntitlementsUseCase({ code, clientRef });
  } catch (error) {
    if (isApplicationNotFound(error)) {
      throw withErrorCode(
        Boom.notFound(
          `No matching application found for clientRef '${clientRef}' and grantCode '${code}'.`,
        ),
        "APPLICATION_NOT_FOUND",
      );
    }

    throw error;
  }
};

const assertClaimCode = ({ grant, offerable, code, clientRef, claimCode }) => {
  if (!grant.findEntitlementTemplate(claimCode)) {
    throw withErrorCode(
      Boom.badData(
        `Claim code '${claimCode}' is not defined for grant code '${code}'.`,
      ),
      "INVALID_CLAIM_CODE",
    );
  }

  const template = offerable.find(
    (candidate) => candidate.claimCode === claimCode,
  );

  if (!template) {
    throw withErrorCode(
      Boom.badData(
        `Claim code '${claimCode}' is not available for application '${clientRef}'.`,
      ),
      "INVALID_CLAIM_CODE",
    );
  }

  return template;
};

const throwEntitlementLimitExceeded = ({ template, claimCode }) => {
  throw withErrorCode(
    Boom.conflict(
      `Cannot create entitlement '${claimCode}'. Maximum instance limit of ${template.maxEntitlements} has been reached.`,
    ),
    "ENTITLEMENT_LIMIT_EXCEEDED",
  );
};

const assertCapacity = ({ template, existing, claimCode }) => {
  const count = existing.filter(
    (entitlement) => entitlement.claimCode === claimCode,
  ).length;

  if (count >= template.maxEntitlements) {
    throwEntitlementLimitExceeded({ template, claimCode });
  }
};

const findAvailableInstanceNumber = ({ template, existing, claimCode }) => {
  const used = new Set(
    existing
      .filter((entitlement) => entitlement.claimCode === claimCode)
      .map((entitlement) => entitlement.instanceNumber)
      .filter(Number.isInteger),
  );

  for (
    let instanceNumber = 1;
    instanceNumber <= template.maxEntitlements;
    instanceNumber += 1
  ) {
    if (!used.has(instanceNumber)) {
      return instanceNumber;
    }
  }

  return undefined;
};

const flattenData = (data) =>
  Object.fromEntries(
    Object.entries(data).map(([name, field]) => [name, field.value]),
  );

const fieldNamesNotIn = (fieldNames, expectedFieldNames) =>
  fieldNames.filter((name) => !expectedFieldNames.includes(name));

const dataProblem = (kind, fieldNames) =>
  fieldNames.length > 0 && `${kind} fields: ${fieldNames.join(", ")}`;

const assertDataMatchesTemplate = ({ template, data, claimCode }) => {
  const inputFieldNames = template.inputFieldNames();
  const submittedFieldNames = Object.keys(data);
  const missingFieldNames = fieldNamesNotIn(
    inputFieldNames,
    submittedFieldNames,
  );
  const unexpectedFieldNames = fieldNamesNotIn(
    submittedFieldNames,
    inputFieldNames,
  );

  if (missingFieldNames.length + unexpectedFieldNames.length === 0) {
    return;
  }

  const problems = [
    dataProblem("missing", missingFieldNames),
    dataProblem("unexpected", unexpectedFieldNames),
  ].filter(Boolean);

  throw withErrorCode(
    Boom.badData(
      `Entitlement data for claim code '${claimCode}' does not match the template: ${problems.join("; ")}.`,
    ),
    "INVALID_ENTITLEMENT_DATA",
  );
};

const fixedFields = (template) =>
  Object.entries(template.fields ?? {}).filter(([, field]) => !field.input);

const needsResolution = (value) =>
  typeof value === "string" &&
  (value.startsWith("jsonata:") || /[$@]\./.test(value));

const resolveFixedData = async ({ template, application, code, clientRef }) => {
  const fields = fixedFields(template);

  if (fields.length === 0) {
    return {};
  }

  const valuesNeedResolution = fields.some(([, field]) =>
    needsResolution(field.value),
  );
  const agreement = valuesNeedResolution
    ? await findAgreementBySourceIdentity({ code, clientRef })
    : undefined;
  const applicationContext = toApplicationContext(application);
  const context = {
    ...applicationContext,
    application: applicationContext,
    agreement,
  };

  return Object.fromEntries(
    await Promise.all(
      fields.map(async ([name, field]) => [
        name,
        valuesNeedResolution && needsResolution(field.value)
          ? await resolveRefs(field.value, { context })
          : field.value,
      ]),
    ),
  );
};
// A unique database slot is the authority on capacity. If another request claims the slot selected from this read,
// resolve again and try the next available slot. This could use template.maxEntitlements; for now, retry
// once only.
const retries = 1;
export const createEntitlementUseCase = async ({
  code,
  clientRef,
  claimCode,
  data,
}) => {
  let template;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { application, grant, offerable, existing } =
      await resolveOrMapNotFound({ code, clientRef });

    template = assertClaimCode({
      grant,
      offerable,
      code,
      clientRef,
      claimCode,
    });

    assertDataMatchesTemplate({ template, data, claimCode });

    assertCapacity({ template, existing, claimCode });

    const instanceNumber = findAvailableInstanceNumber({
      template,
      existing,
      claimCode,
    });

    if (instanceNumber === undefined) {
      throwEntitlementLimitExceeded({ template, claimCode });
    }

    const entitlement = Entitlement.create({
      clientRef,
      code,
      claimCode,
      instanceNumber,
      configVersion: application.currentConfigVersion,
      // Fixed values are controlled by the template, never by the caller.
      data: {
        ...flattenData(data),
        ...(await resolveFixedData({ template, application, code, clientRef })),
      },
    });

    if ((await insertEntitlement(entitlement)) !== false) {
      return entitlement;
    }
  }

  throwEntitlementLimitExceeded({ template, claimCode });
};
