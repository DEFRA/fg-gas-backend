import Boom from "@hapi/boom";
import { Entitlement } from "../models/entitlement.js";
import { insertEntitlement } from "../repositories/entitlement.repository.js";
import { resolveEntitlementsUseCase } from "./resolve-entitlements.use-case.js";

const withErrorCode = (boom, errorCode) => {
  boom.output.payload.errorCode = errorCode;
  return boom;
};

const isApplicationNotFound = (error) =>
  error.isBoom &&
  error.output.statusCode === 404 &&
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

const assertCapacity = ({ template, existing, claimCode }) => {
  const count = existing.filter(
    (entitlement) => entitlement.claimCode === claimCode,
  ).length;

  if (count >= template.maxEntitlements) {
    throw withErrorCode(
      Boom.conflict(
        `Cannot create entitlement '${claimCode}'. Maximum instance limit of ${template.maxEntitlements} has been reached.`,
      ),
      "ENTITLEMENT_LIMIT_EXCEEDED",
    );
  }
};

const flattenData = (data) =>
  Object.fromEntries(
    Object.entries(data).map(([name, field]) => [name, field.value]),
  );

export const createEntitlementUseCase = async ({
  code,
  clientRef,
  claimCode,
  data,
}) => {
  const { application, grant, offerable, existing } =
    await resolveOrMapNotFound({ code, clientRef });

  const template = assertClaimCode({
    grant,
    offerable,
    code,
    clientRef,
    claimCode,
  });

  assertCapacity({ template, existing, claimCode });

  const entitlement = Entitlement.create({
    clientRef,
    code,
    claimCode,
    configVersion: application.currentConfigVersion,
    data: flattenData(data),
  });

  await insertEntitlement(entitlement);

  return entitlement;
};
