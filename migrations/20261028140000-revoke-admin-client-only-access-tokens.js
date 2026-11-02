import { logger } from "../src/common/logger.js";

const adminClient = "fg-grants-platform-admin";

// FGP-1534: auth reads only `clientId`, so a token that names the admin client
// in `client` alone has never passed the grant-admin guard. The backfill left
// these alone because copying the name would let them through. Nothing uses
// them for admin work, so they are revoked. Tokens with a `clientId`, the admin
// frontend's own included, are not touched.
export const up = async (db) => {
  const { deletedCount } = await db.collection("access_tokens").deleteMany({
    client: adminClient,
    $expr: {
      $not: [
        {
          $cond: [
            { $eq: [{ $type: "$clientId" }, "string"] },
            { $ne: [{ $trim: { input: "$clientId" } }, ""] },
            false,
          ],
        },
      ],
    },
  });

  logger.info(
    `Revoked ${deletedCount} ${adminClient} access tokens without a clientId`,
  );
};
