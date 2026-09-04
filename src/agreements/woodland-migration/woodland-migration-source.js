import Boom from "@hapi/boom";
import Joi from "joi";
import { BSON, Double, Int32, Long } from "mongodb";
import { config } from "../../common/config.js";
import { wreck } from "../../common/wreck.js";

const requestTimeout = 30_000;
const successStatusMin = 200;
const successStatusMax = 300;
const successStatus = (statusCode) =>
  statusCode >= successStatusMin && statusCode < successStatusMax;

const agreementNumbersSchema = Joi.object({
  agreementNumbers: Joi.array()
    .items(Joi.string().pattern(/^WMP/))
    .min(1)
    .unique()
    .required(),
});

const versionPageSchema = Joi.object({
  agreement: Joi.object().unknown(true).required(),
  grant: Joi.object().unknown(true).required(),
  versions: Joi.array().items(Joi.object().unknown(true)).max(100).required(),
  nextOffset: Joi.number().integer().min(1).allow(null).required(),
});

const sourceError = () =>
  Boom.badGateway("Woodland migration source request failed");

const sourceUrl = (path) =>
  new URL(path, config.woodlandMigration.sourceUrl).toString();

const get = async (path) => {
  let response;

  try {
    response = await wreck.get(sourceUrl(path), {
      headers: {
        authorization: `Bearer ${config.woodlandMigration.token}`,
      },
      json: true,
      timeout: requestTimeout,
    });
  } catch {
    throw sourceError();
  }

  if (!successStatus(response.statusCode)) {
    throw sourceError();
  }

  return response.payload;
};

const requireValid = (schema, value) => {
  const result = schema.validate(value, {
    abortEarly: false,
    allowUnknown: false,
    convert: false,
  });

  if (result.error) {
    throw sourceError();
  }

  return result.value;
};

const safeLongValue = (value) => {
  const number = value.toNumber();
  return Number.isSafeInteger(number) && BigInt(number) === value.toBigInt()
    ? number
    : value;
};

const runtimeBsonNumber = (value) => {
  if (value instanceof Long) {
    return safeLongValue(value);
  }
  if (value instanceof Int32) {
    return value.valueOf();
  }
  if (value instanceof Double) {
    return value.valueOf();
  }
  return null;
};

const toRuntimeObject = (value) =>
  value?.constructor === Object
    ? Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          toRuntimeSourceValue(entry),
        ]),
      )
    : value;

const toRuntimeSourceValue = (value) => {
  const number = runtimeBsonNumber(value);
  if (number !== null) {
    return number;
  }
  return Array.isArray(value)
    ? value.map(toRuntimeSourceValue)
    : toRuntimeObject(value);
};

const deserializeSource = (value) =>
  toRuntimeSourceValue(BSON.EJSON.deserialize(value, { relaxed: false }));

export const fetchWoodlandAgreementNumbers = async () => {
  const payload = await get("/internal/migrations/agreements?code=woodland");
  return requireValid(agreementNumbersSchema, payload).agreementNumbers;
};

// eslint-disable-next-line complexity
export const fetchWoodlandAgreementVersionPages = async function* (
  agreementNumber,
) {
  let offset = 0;

  do {
    const path = `/internal/migrations/agreements/${encodeURIComponent(agreementNumber)}/versions?offset=${offset}`;
    let page;
    let sourcePage;

    try {
      sourcePage = await get(path);
      page = deserializeSource(structuredClone(sourcePage));
    } catch {
      throw sourceError();
    }

    page = requireValid(versionPageSchema, page);

    const expectedNextOffset = offset + page.versions.length;
    if (
      page.nextOffset !== null &&
      (page.nextOffset !== expectedNextOffset || page.nextOffset <= offset)
    ) {
      throw sourceError();
    }

    yield {
      ...page,
      legacySource: {
        agreement: sourcePage.agreement,
        grant: sourcePage.grant,
        versions: sourcePage.versions,
      },
    };
    offset = page.nextOffset;
  } while (offset !== null);
};
