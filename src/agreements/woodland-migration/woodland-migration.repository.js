import Boom from "@hapi/boom";
import { db } from "../../common/mongo-client.js";
import { Agreement } from "../models/agreement.js";
import {
  agreementsCollection,
  versionsCollection,
} from "../repositories/agreement.repository.js";
import {
  checksum,
  woodlandMigrationMappingVersion,
  woodlandMigrationSource,
} from "./woodland-migration-checksum.js";

const migrationName = "woodland";

const omitUndefinedProperties = (value) =>
  Object.fromEntries(
    Object.entries(value).filter(([, property]) => property !== undefined),
  );

const migrationMarker = (preparedAgreement) => ({
  name: migrationName,
  source: woodlandMigrationSource,
  mappingVersion: woodlandMigrationMappingVersion,
  sourceChecksum: preparedAgreement.sourceChecksum,
});

const currentDocument = (preparedAgreement) => {
  const agreement = preparedAgreement.versions.at(-1).agreementVersion.snapshot;
  return {
    _id: agreement.agreementNumber,
    ...omitUndefinedProperties(structuredClone(agreement)),
    migration: migrationMarker(preparedAgreement),
  };
};

const versionDocument = ({ agreementVersion, evidence }) => ({
  agreementNumber: agreementVersion.agreementNumber,
  version: agreementVersion.version,
  snapshot: {
    ...omitUndefinedProperties(structuredClone(agreementVersion.snapshot)),
    legacy: structuredClone(evidence),
  },
  versionedAt: agreementVersion.versionedAt,
});

const conflict = () =>
  Boom.conflict("Woodland migration target conflicts with existing GAS data");

const preparedIdentity = (preparedAgreement) => {
  const agreement =
    preparedAgreement.versions.at(-1)?.agreementVersion.snapshot;
  return agreement && `${agreement.code}:${agreement.clientRef}`;
};

const requireUniquePreparedIdentities = (preparedAgreements) => {
  const identities = preparedAgreements.map(preparedIdentity);
  if (identities.some((identity) => !identity)) {
    throw conflict();
  }
  if (new Set(identities).size !== identities.length) {
    throw conflict();
  }
};

const findCurrentDocuments = async (preparedAgreements, session) => {
  const agreementNumbers = preparedAgreements.map(
    ({ agreementNumber }) => agreementNumber,
  );
  const clientRefs = preparedAgreements.map(
    (preparedAgreement) =>
      preparedAgreement.versions.at(-1).agreementVersion.snapshot.clientRef,
  );
  return db
    .collection(agreementsCollection)
    .find(
      {
        $or: [
          { _id: { $in: agreementNumbers } },
          { code: "woodland", clientRef: { $in: clientRefs } },
          {
            "migration.name": migrationName,
            "migration.source": woodlandMigrationSource,
          },
        ],
      },
      { session, readPreference: "primary" },
    )
    .toArray();
};

const findVersionDocuments = (preparedAgreements, session) =>
  db
    .collection(versionsCollection)
    .find(
      {
        $or: [
          {
            agreementNumber: {
              $in: preparedAgreements.map(
                ({ agreementNumber }) => agreementNumber,
              ),
            },
          },
          { "snapshot.legacy.source": woodlandMigrationSource },
        ],
      },
      { session, readPreference: "primary" },
    )
    .sort({ agreementNumber: 1, version: 1 })
    .toArray();

const versionsByAgreement = (documents) => {
  const grouped = new Map();
  for (const document of documents) {
    const versions = grouped.get(document.agreementNumber) ?? [];
    versions.push(document);
    grouped.set(document.agreementNumber, versions);
  }
  return grouped;
};

const legacyEvidenceMatches = (stored, expected) =>
  stored?.source === woodlandMigrationSource &&
  stored.checksum === expected.checksum &&
  checksum(stored.envelope) === stored.checksum;

const agreementSnapshotChecksum = (value) =>
  checksum(structuredClone(new Agreement(value)));

const historyMatches = (preparedAgreement, existingVersions) =>
  preparedAgreement.versions.length === existingVersions.length &&
  preparedAgreement.versions.every(
    // eslint-disable-next-line complexity
    ({ agreementVersion, evidence }, index) =>
      existingVersions[index]?.version === agreementVersion.version &&
      existingVersions[index]?.versionedAt === agreementVersion.versionedAt &&
      legacyEvidenceMatches(
        existingVersions[index]?.snapshot?.legacy,
        evidence,
      ) &&
      agreementSnapshotChecksum(existingVersions[index]?.snapshot) ===
        agreementSnapshotChecksum(agreementVersion.snapshot),
  );

const currentAgreementMatches = (existing, preparedAgreement) =>
  agreementSnapshotChecksum(existing) ===
  agreementSnapshotChecksum(
    preparedAgreement.versions.at(-1).agreementVersion.snapshot,
  );

const isMigrationOwned = (document) =>
  document.migration?.name === migrationName &&
  document.migration?.source === woodlandMigrationSource;

const requireKnownHistories = (histories, preparedNumbers) => {
  for (const agreementNumber of histories.keys()) {
    if (!preparedNumbers.has(agreementNumber)) {
      throw conflict();
    }
  }
};

const hasUnexpectedOwnedDocument = (document, preparedNumbers) =>
  isMigrationOwned(document) && !preparedNumbers.has(document._id);

const hasIdentityConflict = (document, expectedByIdentity) => {
  const expectedNumber = expectedByIdentity.get(
    `${document.code}:${document.clientRef}`,
  );
  return Boolean(expectedNumber && expectedNumber !== document._id);
};

const requireCompatibleCurrentDocuments = (
  currentDocuments,
  preparedNumbers,
  expectedByIdentity,
) => {
  const incompatible = currentDocuments.some(
    (document) =>
      hasUnexpectedOwnedDocument(document, preparedNumbers) ||
      hasIdentityConflict(document, expectedByIdentity),
  );
  if (incompatible) {
    throw conflict();
  }
};

const isUnchangedMigration = (existing, preparedAgreement, existingVersions) =>
  existing.migration.mappingVersion === woodlandMigrationMappingVersion &&
  existing.migration.sourceChecksum === preparedAgreement.sourceChecksum &&
  currentAgreementMatches(existing, preparedAgreement) &&
  historyMatches(preparedAgreement, existingVersions);

const requireInsertableHistory = (existingVersions) => {
  if (existingVersions.length > 0) {
    throw conflict();
  }
  return "insert";
};

const requireMatchingOwner = (existing, preparedAgreement) => {
  if (
    !isMigrationOwned(existing) ||
    `${existing.code}:${existing.clientRef}` !==
      preparedIdentity(preparedAgreement)
  ) {
    throw conflict();
  }
};

const versionsFor = (preparedAgreement, histories) =>
  histories.get(preparedAgreement.agreementNumber) ?? [];

const targetDecision = (preparedAgreement, currentByNumber, histories) => {
  const existing = currentByNumber.get(preparedAgreement.agreementNumber);
  const existingVersions = versionsFor(preparedAgreement, histories);

  if (!existing) {
    return requireInsertableHistory(existingVersions);
  }

  requireMatchingOwner(existing, preparedAgreement);
  return isUnchangedMigration(existing, preparedAgreement, existingVersions)
    ? "skip"
    : "replace";
};

const buildTargetDecisions = (
  preparedAgreements,
  currentByNumber,
  histories,
) => {
  const decisions = { insert: [], replace: [], skip: [] };
  for (const preparedAgreement of preparedAgreements) {
    const decision = targetDecision(
      preparedAgreement,
      currentByNumber,
      histories,
    );
    decisions[decision].push(preparedAgreement);
  }
  return decisions;
};

export const inspectWoodlandMigrationTargets = async (
  preparedAgreements,
  session,
) => {
  requireUniquePreparedIdentities(preparedAgreements);
  // Mongo sessions do not support parallel operations within a transaction.
  const currentDocuments = await findCurrentDocuments(
    preparedAgreements,
    session,
  );
  const versionDocuments = await findVersionDocuments(
    preparedAgreements,
    session,
  );
  const currentByNumber = new Map(
    currentDocuments.map((document) => [document._id, document]),
  );
  const expectedByIdentity = new Map(
    preparedAgreements.map((preparedAgreement) => [
      preparedIdentity(preparedAgreement),
      preparedAgreement.agreementNumber,
    ]),
  );
  const histories = versionsByAgreement(versionDocuments);
  const preparedNumbers = new Set(
    preparedAgreements.map(({ agreementNumber }) => agreementNumber),
  );

  requireKnownHistories(histories, preparedNumbers);
  requireCompatibleCurrentDocuments(
    currentDocuments,
    preparedNumbers,
    expectedByIdentity,
  );
  return buildTargetDecisions(preparedAgreements, currentByNumber, histories);
};

const writeAgreement = async (preparedAgreement, replace, session) => {
  const agreements = db.collection(agreementsCollection);
  const versions = db.collection(versionsCollection);
  const document = currentDocument(preparedAgreement);

  if (replace) {
    const result = await agreements.replaceOne(
      {
        _id: preparedAgreement.agreementNumber,
        "migration.name": migrationName,
        "migration.source": woodlandMigrationSource,
      },
      document,
      { session },
    );
    if (result.matchedCount !== 1) {
      throw conflict();
    }
    await versions.deleteMany(
      { agreementNumber: preparedAgreement.agreementNumber },
      { session },
    );
  } else {
    await agreements.insertOne(document, { session });
  }

  await versions.insertMany(preparedAgreement.versions.map(versionDocument), {
    session,
  });
};

export const writeWoodlandMigration = async (decisions, session) => {
  for (const preparedAgreement of decisions.insert) {
    await writeAgreement(preparedAgreement, false, session);
  }
  for (const preparedAgreement of decisions.replace) {
    await writeAgreement(preparedAgreement, true, session);
  }
};

export const reconcileWoodlandMigration = async (
  preparedAgreements,
  session,
) => {
  const decisions = await inspectWoodlandMigrationTargets(
    preparedAgreements,
    session,
  );
  if (
    decisions.insert.length > 0 ||
    decisions.replace.length > 0 ||
    decisions.skip.length !== preparedAgreements.length
  ) {
    throw Boom.internal("Woodland migration reconciliation failed");
  }
};
