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

/* eslint-disable complexity */
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

  for (const agreementNumber of histories.keys()) {
    if (!preparedNumbers.has(agreementNumber)) {
      throw conflict();
    }
  }

  for (const document of currentDocuments) {
    if (isMigrationOwned(document) && !preparedNumbers.has(document._id)) {
      throw conflict();
    }
    const expectedNumber = expectedByIdentity.get(
      `${document.code}:${document.clientRef}`,
    );
    if (expectedNumber && expectedNumber !== document._id) {
      throw conflict();
    }
  }

  const decisions = { insert: [], replace: [], skip: [] };
  for (const preparedAgreement of preparedAgreements) {
    const existing = currentByNumber.get(preparedAgreement.agreementNumber);
    const existingVersions =
      histories.get(preparedAgreement.agreementNumber) ?? [];

    if (!existing) {
      if (existingVersions.length > 0) {
        throw conflict();
      }
      decisions.insert.push(preparedAgreement);
      continue;
    }

    if (
      !isMigrationOwned(existing) ||
      `${existing.code}:${existing.clientRef}` !==
        preparedIdentity(preparedAgreement)
    ) {
      throw conflict();
    }

    if (
      existing.migration.mappingVersion === woodlandMigrationMappingVersion &&
      existing.migration.sourceChecksum === preparedAgreement.sourceChecksum &&
      currentAgreementMatches(existing, preparedAgreement) &&
      historyMatches(preparedAgreement, existingVersions)
    ) {
      decisions.skip.push(preparedAgreement);
    } else {
      decisions.replace.push(preparedAgreement);
    }
  }

  return decisions;
};
/* eslint-enable complexity */

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
