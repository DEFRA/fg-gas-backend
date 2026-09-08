import Joi from "joi";
import { isCalendarDate } from "../schemas/agreement-value.schema.js";

export const woodlandTimestampSchema = Joi.string()
  .isoDate()
  .custom((value, helpers) =>
    isCalendarDate(value.slice(0, 10)) ? value : helpers.error("date.calendar"),
  );

const timestampString = (value) =>
  value instanceof Date && !Number.isNaN(value.valueOf())
    ? value.toISOString()
    : value;

const validTimestampMillis = (value) => {
  const timestamp = timestampString(value);
  return woodlandTimestampSchema
    .required()
    .validate(timestamp, { convert: false }).error
    ? undefined
    : Date.parse(timestamp);
};

const precedes = (left, right) =>
  left !== undefined && right !== undefined && left < right;

export const acceptedTimestampOrderIssues = (sourceVersion, agreement) =>
  agreement.state === "accepted" &&
  precedes(
    validTimestampMillis(agreement.acceptedAt),
    validTimestampMillis(sourceVersion.createdAt),
  )
    ? [
        {
          path: "acceptedAt",
          reason: "woodland.acceptance-timestamp.before-offer",
        },
      ]
    : [];
