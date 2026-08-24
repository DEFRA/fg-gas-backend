import Boom from "@hapi/boom";
import { buildClaimsView } from "../services/build-claims-view.js";
import { resolveEntitlementsUseCase } from "./resolve-entitlements.use-case.js";

export const findClaimUseCase = async ({ code, clientRef, claimCode }) => {
  const { application, grant, offerable, available, existing } =
    await resolveEntitlementsUseCase({ code, clientRef });

  const entitlementTemplate = offerable.find(
    (template) => template.claimCode === claimCode,
  );

  if (!entitlementTemplate) {
    throw Boom.notFound(
      `No entitlement available for claim code "${claimCode}" on application "${clientRef}"`,
    );
  }

  const existingForClaimCode = existing.filter(
    (entitlement) => entitlement.claimCode === claimCode,
  );

  if (existingForClaimCode.length >= entitlementTemplate.maxEntitlements) {
    throw Boom.conflict(
      `Application "${clientRef}" already has ${existingForClaimCode.length} of ${entitlementTemplate.maxEntitlements} entitlements for claim code "${claimCode}"`,
    );
  }

  const claims = await buildClaimsView({ grant, application, available });

  return {
    ...claims,
    entitlementTemplate,
  };
};
