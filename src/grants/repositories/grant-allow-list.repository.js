import { db } from "../../common/mongo-client.js";
import { GrantAllowList } from "../models/grant-allow-list.js";

const collection = "allow_lists";

export const findByGrantCodes = async (grantCodes) => {
  if (grantCodes.length === 0) return [];
  const documents = await db
    .collection(collection)
    .find({ grantCode: { $in: grantCodes } })
    .toArray();
  return documents.map((doc) => GrantAllowList.fromDocument(doc));
};

const sessionOptions = (session) => (session ? { session } : undefined);

export const findByGrantCode = async (grantCode, session) => {
  const allowLists = db.collection(collection);
  const options = sessionOptions(session);
  const document = options
    ? await allowLists.findOne({ grantCode }, options)
    : await allowLists.findOne({ grantCode });

  return document ? GrantAllowList.fromDocument(document) : null;
};

export const replace = async (allowList, session) => {
  const options = { upsert: true, ...sessionOptions(session) };

  await db
    .collection(collection)
    .replaceOne(
      { grantCode: allowList.grantCode },
      allowList.toDocument(),
      options,
    );
};
