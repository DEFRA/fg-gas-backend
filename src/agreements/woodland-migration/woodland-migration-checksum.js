import { createHash } from "node:crypto";

export const woodlandMigrationMappingVersion = 1;
export const woodlandMigrationSource = "legacy-agreements";

const CLAIM_SEQUENCE_BOUNDARY = 1000;
export const maximumLegacyClaimIdSequence = 9_007_199_254_739_999;

const unsafeClaimSequence = () =>
  new RangeError("Legacy claim ID sequence cannot derive a safe GAS sequence");

const isValidLegacyClaimSequence = (legacySeq) =>
  Number.isSafeInteger(legacySeq) &&
  legacySeq >= 0 &&
  legacySeq <= maximumLegacyClaimIdSequence;

const isExactlyRepresentableHandoff = (firstGasSequence, persistedSequence) =>
  Number.isSafeInteger(firstGasSequence) &&
  Number.isSafeInteger(persistedSequence) &&
  firstGasSequence - persistedSequence === 1;

// Smallest multiple of 1000 strictly greater than the legacy sequence.
export const deriveFirstGasClaimSequence = (legacySeq) => {
  if (!isValidLegacyClaimSequence(legacySeq)) {
    throw unsafeClaimSequence();
  }

  const firstGasSequence =
    (Math.floor(legacySeq / CLAIM_SEQUENCE_BOUNDARY) + 1) *
    CLAIM_SEQUENCE_BOUNDARY;
  const persistedSequence = firstGasSequence - 1;

  if (
    firstGasSequence <= legacySeq ||
    !isExactlyRepresentableHandoff(firstGasSequence, persistedSequence)
  ) {
    throw unsafeClaimSequence();
  }

  return firstGasSequence;
};

// eslint-disable-next-line complexity
const canonicalise = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (value !== null && value?.constructor === Object) {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right, "en"))
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
  claimIdCounterSeq,
}) =>
  checksum({
    source: woodlandMigrationSource,
    mappingVersion: woodlandMigrationMappingVersion,
    configVersion,
    agreementChecksums,
    claimIdCounterSeq,
  });
