import { db } from "../../common/mongo-client.js";

// Identity only: any known version counts, independently of administration
// permissions, publication status or grant availability.
export const findIdentityByCode = async (grantCode) => {
  const legacy = await db
    .collection("grants")
    .findOne({ code: grantCode }, { projection: { _id: 0, code: 1 } });
  if (legacy) {
    return { grantCode: legacy.code };
  }

  return db
    .collection("config_versions")
    .findOne({ grantCode }, { projection: { _id: 0, grantCode: 1 } });
};
