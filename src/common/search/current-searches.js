const VERSIONS = "config_versions";
const CHANGES = "config_changes";
const ACTIVE = "active";
const PRIMARY = { readPreference: "primary" };

// Each code's active versions, highest first.
const ACTIVE_VERSIONS = [
  { $match: { status: ACTIVE } },
  { $sort: { grantCode: 1, major: -1, minor: -1, patch: -1 } },
  { $group: { _id: "$grantCode", versions: { $push: "$version" } } },
];

// Counts the changes to what a code's current version can be: a version
// arriving, changing status or having its definition stored. Written in the
// caller's session, so it commits with the change it counts.
export const recordConfigChange = (database, code, session) =>
  database
    .collection(CHANGES)
    .updateOne(
      { _id: code },
      { $inc: { change: 1 } },
      { upsert: true, session },
    );

// Each code with the `search` of its current version, null when that declares
// none: its highest active version that is stored, as a version that has not
// been fetched, or never will be, leaves the service on the one before. A
// code with no active version stored is left out, so nothing is rebuilt or
// swept for it until it has one.
export const currentSearchesOf = (current, stored, changes) => {
  const storedByVersion = new Map(
    stored.map((doc) => [`${doc.code}@${doc.version}`, doc]),
  );
  const changeByCode = new Map(changes.map(({ _id, change }) => [_id, change]));

  return current.flatMap(({ _id, versions }) => {
    const found = versions
      .map((version) => storedByVersion.get(`${_id}@${version}`))
      .find(Boolean);

    return found
      ? [
          {
            value: _id,
            search: found.search ?? null,
            change: changeByCode.get(_id) ?? 0,
          },
        ]
      : [];
  });
};

// `definitions` is the collection holding each stored version's definition
// by `code` and `version`. The counts are read first, so a declaration is
// never stamped with a count later than the versions it was read from.
export const findCurrentSearches = async (database, definitions) => {
  const changes = await database
    .collection(CHANGES)
    .find({}, PRIMARY)
    .toArray();
  const current = await database
    .collection(VERSIONS)
    .aggregate(ACTIVE_VERSIONS, PRIMARY)
    .toArray();

  if (current.length === 0) {
    return [];
  }

  const stored = await database
    .collection(definitions)
    .find(
      {
        $or: current.map(({ _id, versions }) => ({
          code: _id,
          version: { $in: versions },
        })),
      },
      { ...PRIMARY, projection: { _id: 0, code: 1, version: 1, search: 1 } },
    )
    .toArray();

  return currentSearchesOf(current, stored, changes);
};
