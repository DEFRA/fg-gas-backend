import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { findExistingEntitlements } from "../repositories/entitlement.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";
import { resolveCurrentGrantUseCase } from "./resolve-current-grant.use-case.js";

// Stubbed response while entitlement creation and claims storage are not yet
// implemented. Set to false once the live resolution path is ready.
const IS_STUBBED = true;

const stubbedResponse = {
  availableClaims: [
    {
      code: "ENT_CS_CAPITAL_PA3",
      name: "PA3 Woodland Management Plan entitlement",
      description:
        "The maximum eligible woodland area that can be claimed under PA3.",
      data: {
        totalHectares: {
          value: 455000,
          decimalPlaces: 4,
          minValue: 0.5,
          maxValue: null,
        },
        actionCode: {
          value: "PA3",
        },
        actionVersion: {
          value: "1.2.3",
        },
      },
    },
  ],
};

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

const resolveLive = async (code, clientRef) => {
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

export const findAvailableClaimsUseCase = async ({ code, clientRef }) => {
  if (IS_STUBBED) {
    logger.info(
      `Returning stubbed available claims for grant ${code} and clientRef ${clientRef}`,
    );
    return stubbedResponse;
  }

  return resolveLive(code, clientRef);
};
