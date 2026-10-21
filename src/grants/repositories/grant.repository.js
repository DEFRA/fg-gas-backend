import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { config } from "../../common/config.js";
import {
  cappedField,
  storedBytes,
} from "../../common/mongo/capped-projection.js";
import { db } from "../../common/mongo-client.js";
import { GrantDocument } from "../models/grant-document.js";
import { Grant } from "../models/grant.js";

const optionalBlock = (value) => value ?? undefined;

// Stored documents predate most of what the model now expects: a grant written
// before entitlement templates existed has no such key, and one written without
// any comes back as null, because the driver resolves ignoreUndefined to false.
// Normalising here keeps that drift where it belongs - in the layer that owns
// the stored shape - so the domain model can take a well-formed collection and
// not accumulate a guard per field per schema change.
export const toGrant = (doc) =>
  new Grant({
    code: doc.code,
    version: doc.version,
    metadata: doc.metadata,
    actions: doc.actions,
    phases: doc.phases,
    externalStatusMap: doc.externalStatusMap,
    amendablePositions: doc.amendablePositions ?? [],
    entitlementTemplates: doc.entitlementTemplates ?? [],
    // Stored as null by the driver when a grant carries none, which the model
    // reads as "absent" only if it arrives undefined.
    pages: optionalBlock(doc.pages),
    claims: optionalBlock(doc.claims),
    admin: optionalBlock(doc.admin),
  });

export const collection = "grants";

export const save = async (grant) => {
  const document = new GrantDocument(grant);

  try {
    await db.collection(collection).insertOne(document);
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw Boom.conflict(
        `Grant with code "${grant.code}" version "${grant.version}" already exists`,
      );
    }

    throw error;
  }
};

export const findByCode = async (code, version) => {
  const grants = db.collection(collection);
  const filter = { code, version: version ?? "0.0.0" };
  const result = await grants.findOne(filter);

  return result && toGrant(result);
};

export const saveFromDefinition = async (grantDefinition, version) => {
  const grant = new Grant({ ...grantDefinition, version });
  await save(grant);
  return grant;
};

export const findStoredVersions = async (code, versions) => {
  const documents = await db
    .collection(collection)
    .find(
      { code, version: { $in: versions } },
      {
        projection: { _id: 0, version: 1 },
        maxTimeMS: config.adminReadTimeoutMs,
      },
    )
    .toArray();

  return documents.map(({ version }) => version);
};

const readOne = async (pipeline) => {
  const [doc] = await db
    .collection(collection)
    .aggregate(pipeline, { maxTimeMS: config.adminReadTimeoutMs })
    .toArray();

  return doc ?? null;
};

const orNull = (path) => ({ $ifNull: [path, null] });

export const findStoredGrantSummary = (code, version) =>
  readOne([
    { $match: { code, version } },
    {
      $project: {
        _id: 0,
        description: "$metadata.description",
        startDate: "$metadata.startDate",
        adminRole: orNull("$admin.role"),
        storedBytes,
      },
    },
  ]);

// The stored document exactly as stored, less its _id. One over `maxBytes` is
// never sent: only its size is.
export const findStoredGrantDocument = async (code, version, { maxBytes }) => {
  const found = await readOne([
    { $match: { code, version } },
    {
      $project: {
        _id: 0,
        storedBytes,
        document: cappedField(
          { $unsetField: { field: "_id", input: "$$ROOT" } },
          maxBytes,
        ),
      },
    },
  ]);

  return found
    ? { storedBytes: found.storedBytes, document: found.document ?? null }
    : null;
};
