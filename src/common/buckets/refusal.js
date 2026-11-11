import Boom from "@hapi/boom";

const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const GATEWAY_TIMEOUT = 504;

const refusals = {
  UNKNOWN_BUCKET: { statusCode: NOT_FOUND, message: "No such bucket" },
  UNKNOWN_SUMMARY: {
    statusCode: NOT_FOUND,
    message: "This bucket declares no such summary",
  },
  UNKNOWN_FACT: {
    statusCode: BAD_REQUEST,
    message: "A filter names a fact this bucket does not declare",
  },
  UNKNOWN_REF_KIND: {
    statusCode: BAD_REQUEST,
    message: "The search names an identifier kind this bucket does not declare",
  },
  UNKNOWN_GROUPING: {
    statusCode: BAD_REQUEST,
    message: "A grouping names a fact this bucket does not group by",
  },
  UNKNOWN_FIELD: {
    statusCode: BAD_REQUEST,
    message: "The search names a field its definition does not declare",
  },
  FIELD_NEEDS_LEAD: {
    statusCode: BAD_REQUEST,
    message: "A field search needs the one value its fields are declared for",
  },
  FIELD_WITH_FILTER: {
    statusCode: BAD_REQUEST,
    message: "A field search cannot be combined with another filter or a ref",
  },
  INVALID_FIELD_VALUE: {
    statusCode: BAD_REQUEST,
    message:
      "A searched value needs a letter or digit, and at most 200 characters",
  },
  FIELD_TOO_SHORT: {
    statusCode: BAD_REQUEST,
    message: "A field searched by its start needs at least 3 letters or digits",
  },
  INVALID_CURSOR: {
    statusCode: BAD_REQUEST,
    message: "The cursor cannot be read",
  },
  INVALID_RANGE: {
    statusCode: BAD_REQUEST,
    message: '"from" must be earlier than or equal to "to"',
  },
  INVALID_REQUEST: {
    statusCode: BAD_REQUEST,
    message: "The request is not a bucket query",
  },
  TIMED_OUT: {
    statusCode: GATEWAY_TIMEOUT,
    message: "The read did not finish in time",
  },
};

export const REFUSAL_REASONS = Object.keys(refusals);

export const refuse = (reason) => {
  const { statusCode, message } = refusals[reason];
  const error = new Boom.Boom(message, { statusCode });

  error.output.payload.reason = reason;

  return error;
};
