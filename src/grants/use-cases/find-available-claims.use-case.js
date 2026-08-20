import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { findExistingEntitlements } from "../repositories/entitlement.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";
import { resolveCurrentGrantUseCase } from "./resolve-current-grant.use-case.js";

const resolveFieldValue = (fieldName, fieldDef, entitlementData) =>
  entitlementData?.[fieldName] ?? fieldDef.value ?? null;

const buildDecimalDataField = (value, fieldDef) => ({
  value,
  decimalPlaces: fieldDef.decimalPlaces,
  minValue: fieldDef.minValue ?? null,
  maxValue: fieldDef.maxValue ?? null,
});

const buildDataField = (fieldName, fieldDef, entitlementData) => {
  const value = resolveFieldValue(fieldName, fieldDef, entitlementData);

  if (fieldDef.unitType === "decimal") {
    return buildDecimalDataField(value, fieldDef);
  }

  return { value };
};

const buildData = (fields, entitlementData) => {
  const data = {};
  for (const [fieldName, fieldDef] of Object.entries(fields ?? {})) {
    data[fieldName] = buildDataField(fieldName, fieldDef, entitlementData);
  }
  return data;
};

const buildAvailableClaim = (template, entitlement) => ({
  code: template.claimCode,
  name: template.name,
  description: template.description ?? null,
  data: buildData(template.fields, entitlement?.data),
});

const findEntitlementsForClaimCode = (existing, claimCode) =>
  existing.filter((e) => e.claimCode === claimCode);

const collectAvailableClaims = (templates, existing) => {
  const availableClaims = [];

  for (const template of templates) {
    if (template.materialised) {
      continue;
    }

    const matched = findEntitlementsForClaimCode(existing, template.claimCode);
    for (const entitlement of matched) {
      availableClaims.push(buildAvailableClaim(template, entitlement));
    }
  }

  return availableClaims;
};

const resolveGrant = async (code, configVersion) => {
  const { grant } = await resolveCurrentGrantUseCase(code, configVersion);

  if (!grant) {
    throw Boom.notFound(`Grant with code "${code}" not found`);
  }

  return grant;
};

export const findAvailableClaimsUseCase = async ({ code, clientRef }) => {
  const application = await findApplicationByClientRefAndCodeUseCase(
    clientRef,
    code,
  );

  logger.info(
    { currentConfigVersion: application.currentConfigVersion },
    `Resolving available claims for ${clientRef}`,
  );

  const grant = await resolveGrant(code, application.currentConfigVersion);
  const position = application.currentPosition();
  const templates = grant.findEntitlementTemplatesAvailableAt(position);
  const existing = await findExistingEntitlements(clientRef, code);
  const availableClaims = collectAvailableClaims(templates, existing);

  logger.info(
    { count: availableClaims.length },
    `Available claims resolved for ${clientRef}`,
  );

  return { availableClaims };
};
