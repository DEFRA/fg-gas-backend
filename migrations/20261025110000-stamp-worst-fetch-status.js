import { ensureIndexes } from "../src/common/buckets/indexes.js";
import { withWorstFetchStatus } from "../src/common/config-broker/config-catalog.repository.js";
import { logger } from "../src/common/logger.js";
import { grantsBucket } from "../src/grants/buckets/grants.bucket.js";

// The grants bucket indexes on the grant file's fetch status, which the worst
// fetch status replaces.
const supersededKeys = [
  {
    grantCode: 1,
    status: 1,
    "definitions.grant.fetchStatus": 1,
    receivedAt: -1,
    _id: -1,
  },
  { status: 1, "definitions.grant.fetchStatus": 1, receivedAt: -1, _id: -1 },
];

const NAMESPACE_NOT_FOUND = 26;
const SHOWN = 10;

const namesOf = (rows) =>
  rows.map(({ grantCode, version }) => `${grantCode}@${version}`).join(", ");

const assertRankable = async (configVersions) => {
  const unrankable = await configVersions
    .aggregate([
      withWorstFetchStatus,
      {
        $match: {
          $or: [
            { "definitions.grant": { $not: { $type: "object" } } },
            { worstFetchStatus: null },
          ],
        },
      },
      { $limit: SHOWN },
      { $project: { _id: 0, grantCode: 1, version: 1 } },
    ])
    .toArray();

  if (unrankable.length > 0) {
    throw new Error(
      `Config versions with no grant file or a fetch status GAS does not know: ${namesOf(unrankable)}`,
    );
  }
};

const dropSupersededIndexes = async (configVersions) => {
  const indexes = await configVersions.indexes().catch((error) => {
    if (error.code !== NAMESPACE_NOT_FOUND) {
      throw error;
    }

    return [];
  });
  const superseded = indexes.filter(({ key }) =>
    supersededKeys.some(
      (supersededKey) => JSON.stringify(key) === JSON.stringify(supersededKey),
    ),
  );

  for (const { name } of superseded) {
    await configVersions.dropIndex(name);
  }
};

const assertStamped = async (configVersions, upTo) => {
  const unstamped = await configVersions
    .find(
      { _id: { $lte: upTo }, worstFetchStatus: null },
      { projection: { _id: 0, grantCode: 1, version: 1 }, limit: SHOWN },
    )
    .toArray();

  if (unstamped.length > 0) {
    throw new Error(
      `Config versions left without a worst fetch status: ${namesOf(unstamped)}`,
    );
  }
};

export const up = async (db) => {
  const configVersions = db.collection("config_versions");
  const newest = await configVersions.findOne(
    {},
    { sort: { _id: -1 }, projection: { _id: 1 } },
  );

  await assertRankable(configVersions);
  const { modifiedCount } = await configVersions.updateMany({}, [
    withWorstFetchStatus,
  ]);
  await dropSupersededIndexes(configVersions);
  await ensureIndexes(db, grantsBucket());

  if (newest) {
    await assertStamped(configVersions, newest._id);
  }

  logger.info(
    `Stamped the worst fetch status on ${modifiedCount} config versions`,
  );
};
