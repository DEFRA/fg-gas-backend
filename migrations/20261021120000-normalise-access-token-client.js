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
  const conflicts = await tokens.countDocuments(
    {
      $expr: {
        $and: [
          hasIdentity("$client"),
          hasIdentity("$clientId"),
          { $ne: ["$client", "$clientId"] },
        ],
      },
    },
    { readPreference: "primary" },
  );

  if (conflicts > 0) {
    throw new Error(
      `Cannot normalise access tokens: ${conflicts} conflicting client/clientId identities require review`,
    );
  }

  // auth.js previously admitted admin callers only through clientId. Do not
  // silently promote existing client-only admin tokens when switching readers.
  // Only BSON Dates are excluded as expired: strings and arrays are not valid
  // expiry dates and must not bypass this authorisation check.
  const adminAccessChanges = await tokens.countDocuments(
    {
      $expr: {
        $and: [
          { $eq: ["$client", "fg-grants-platform-admin"] },
          {
            $ne: [{ $ifNull: ["$clientId", null] }, "fg-grants-platform-admin"],
          },
          {
            $not: [
              {
                $and: [
                  { $eq: [{ $type: "$expiresAt" }, "date"] },
                  { $lt: ["$expiresAt", new Date()] },
                ],
              },
            ],
          },
        ],
      },
    },
    { readPreference: "primary" },
  );

  if (adminAccessChanges > 0) {
    throw new Error(
      `Cannot normalise access tokens: ${adminAccessChanges} tokens would gain grant-admin access; no tokens changed. A reviewed token remediation migration is required`,
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
