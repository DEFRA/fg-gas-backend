import Joi from "joi";
import { refuse } from "../../../common/buckets/refusal.js";
import {
  decodePositions,
  encodePositions,
} from "../../../common/explore/merge.js";

// A group's cursor is each member's position, as Explore's merge keeps them
// by bucket id (`p`, itself base64url), and the members that have read
// bounded on any page of the walk (`b`).
const MAX_POSITIONS_LENGTH = 400;
const OBJECT_ID = /^[0-9a-f]{24}$/;

const cursorSchema = Joi.object({
  p: Joi.string().max(MAX_POSITIONS_LENGTH).required(),
  b: Joi.array().items(Joi.string()).unique().required(),
});

const invalid = () => refuse("INVALID_CURSOR");

export const encodeGroupCursor = ({ positions, bounded }) =>
  Buffer.from(
    JSON.stringify({ p: encodePositions(positions), b: bounded }),
  ).toString("base64url");

const refuseInherited = (key, value) => {
  if (key === "__proto__") {
    throw new TypeError("The cursor names an inherited key");
  }

  return value;
};

// A cursor's base64url JSON, any inherited key refused.
export const parseCursorText = (text) =>
  JSON.parse(Buffer.from(text, "base64url").toString(), refuseInherited);

const parsed = (text) => {
  try {
    return parseCursorText(text);
  } catch {
    return undefined;
  }
};

const positionsOf = (text) => {
  try {
    return decodePositions(text);
  } catch {
    throw invalid();
  }
};

// Times and ids are compared as text with the rows' own, so a time only as
// `toISOString` spells it, and an id only in lower-case hex.
const isCanonicalTime = (t) => {
  try {
    return new Date(t).toISOString() === t;
  } catch {
    return false;
  }
};

const isCanonical = (position) =>
  position === null ||
  (isCanonicalTime(position.t) && OBJECT_ID.test(position.i));

const isValid = (positions, bounded, members) =>
  Object.keys(positions).every((id) => members.has(id)) &&
  bounded.every((id) => members.has(id)) &&
  Object.values(positions).every(isCanonical);

// `reading` are the members the address reads: each must have a position,
// and any other's is left out.
export const decodeGroupCursor = (text, group, reading) => {
  const { error, value } = cursorSchema.required().validate(parsed(text));

  if (error) {
    throw invalid();
  }

  const positions = positionsOf(value.p);
  const members = new Set(group.members.map(({ bucket }) => bucket));

  if (
    !isValid(parsed(value.p), value.b, members) ||
    !reading.every(({ bucket }) => Object.hasOwn(positions, bucket))
  ) {
    throw invalid();
  }

  return {
    positions: Object.fromEntries(
      reading.map(({ bucket }) => [bucket, positions[bucket]]),
    ),
    bounded: value.b,
  };
};
