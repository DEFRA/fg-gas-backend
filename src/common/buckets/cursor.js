import { ObjectId } from "mongodb";
import { toIso, toStoredTime } from "./bucket.js";
import { refuse } from "./refusal.js";

export const encodeCursor = ({ t, i }) =>
  Buffer.from(JSON.stringify({ t: toIso(t), i: String(i) })).toString(
    "base64url",
  );

const toTime = (bucket, t) => {
  if (typeof t !== "string") {
    throw new TypeError("Cursor time is not a string");
  }

  return toStoredTime(bucket, new Date(t).toISOString());
};

const toId = (i) => {
  if (typeof i !== "string" || i === "") {
    throw new TypeError("Cursor id is not a string");
  }

  return ObjectId.createFromHexString(i);
};

export const decodeCursor = (bucket, cursor) => {
  try {
    const { t, i } = JSON.parse(Buffer.from(cursor, "base64url").toString());

    return { t: toTime(bucket, t), i: toId(i) };
  } catch {
    throw refuse("INVALID_CURSOR");
  }
};
