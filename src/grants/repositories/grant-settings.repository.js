import { db } from "../../common/mongo-client.js";
import { GrantSettings } from "../models/grant-settings.js";

export const findByGrantCode = async (grantCode, session) => {
  const document = await db
    .collection("grant_settings")
    .findOne({ grantCode }, ...(session ? [{ session }] : []));
  return document ? GrantSettings.fromDocument(document) : null;
};

export const save = async (settings, session) => {
  await db
    .collection("grant_settings")
    .updateOne(
      { grantCode: settings.grantCode },
      { $set: settings.toDocument() },
      { upsert: true, ...(session && { session }) },
    );
};
