// $cond keeps $trim away from missing, null and non-string legacy values.
const hasIdentity = (field) => ({
  $cond: [
    { $eq: [{ $type: field }, "string"] },
    { $ne: [{ $trim: { input: field } }, ""] },
    false,
  ],
});

export const up = async (db) => {
  const tokens = db.collection("access_tokens");
  const conflicts = await tokens.countDocuments({
    $expr: {
      $and: [
        hasIdentity("$client"),
        hasIdentity("$clientId"),
        { $ne: ["$client", "$clientId"] },
      ],
    },
  });

  if (conflicts > 0) {
    throw new Error(
      `Cannot normalise access tokens: ${conflicts} conflicting client/clientId identities require review`,
    );
  }

  // Preserve the token, expiry and legacy field for older running instances.
  // Removal of clientId belongs in a later release, after those readers stop.
  await tokens.updateMany(
    {
      $expr: {
        $and: [hasIdentity("$clientId"), { $not: [hasIdentity("$client")] }],
      },
    },
    [{ $set: { client: "$clientId" } }],
  );
};
