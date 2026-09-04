import { createHash } from "node:crypto";

export const woodlandMigrationMappingVersion = 1;
export const woodlandMigrationSource = "legacy-agreements";

// eslint-disable-next-line complexity
const canonicalise = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (value !== null && value?.constructor === Object) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalise(value[key])]),
    );
  }
  return value;
};

export const checksum = (value) =>
  `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalise(value)), "utf8")
    .digest("hex")}`;

export const createLegacyEvidence = (envelope) => {
  const untouchedEnvelope = structuredClone(envelope);
  return {
    source: woodlandMigrationSource,
    checksum: checksum(untouchedEnvelope),
    envelope: untouchedEnvelope,
  };
};

export const createAgreementSourceChecksum = ({
  agreementNumber,
  configVersion,
  versionChecksums,
}) =>
  checksum({
    source: woodlandMigrationSource,
    mappingVersion: woodlandMigrationMappingVersion,
    configVersion,
    agreementNumber,
    versionChecksums,
  });

export const createMigrationSourceChecksum = ({
  configVersion,
  agreementChecksums,
}) =>
  checksum({
    source: woodlandMigrationSource,
    mappingVersion: woodlandMigrationMappingVersion,
    configVersion,
    agreementChecksums,
  });
