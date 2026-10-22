import Joi from "joi";
import { FetchStatus } from "../../common/fetch-status.js";
import {
  nullableIso,
  nullableString,
  recordPageSchema,
  storedBytesSchema as storedBytes,
} from "./admin-record.schema.js";
import { code } from "./code.js";
import { version } from "./version.js";

export const grantParamsSchema = Joi.object({ code }).label("GrantParams");

export const grantVersionParamsSchema = Joi.object({ code, version }).label(
  "GrantVersionParams",
);

const versionStatus = Joi.string().valid("active", "draft").required();

const grantVersionSchema = Joi.object({
  version: Joi.string().required(),
  status: versionStatus,
  receivedAt: Joi.string().isoDate().required(),
}).label("GrantVersion");

// Newest first.
const versionsSchema = Joi.array().items(grantVersionSchema).required();

export const grantVersionsSchema = Joi.object({
  code: Joi.string().required(),
  current: Joi.string().allow(null).required(),
  versions: versionsSchema,
}).label("GrantVersions");

const definitionFileSchema = Joi.object({
  stored: Joi.boolean().required(),
  fetchStatus: Joi.string()
    .valid(...Object.values(FetchStatus))
    .required(),
}).label("DefinitionFile");

// A file the version has no location for is absent, never null.
const grantVersionHeaderSchema = Joi.object({
  code: Joi.string().required(),
  version: Joi.string().required(),
  status: versionStatus,
  receivedAt: Joi.string().isoDate().required(),
  files: Joi.object({
    grant: definitionFileSchema.required(),
    agreement: definitionFileSchema,
    payment: definitionFileSchema,
  })
    .required()
    .label("DefinitionFiles"),
  versions: versionsSchema,
})
  .required()
  .label("GrantVersionHeader");

// Null when the read failed; each fact is null while the grant file is not stored.
const overviewSchema = Joi.object({
  description: nullableString,
  startDate: nullableIso,
  adminRole: nullableString,
  storedBytes,
})
  .allow(null)
  .required()
  .label("GrantVersionOverview");

// The stored grant document as stored: null when not stored or too large.
const definitionSchema = Joi.object().unknown(true).allow(null).required();

// The stored payment definition as stored: null when not stored or too large.
const paymentSchema = Joi.object().unknown(true).allow(null).required();

// A Service Address keeps the definition's path placeholders, so it is not
// always a valid URI. Null when the service has no usable URL here.
const processAddressSchema = Joi.object({
  process: Joi.string().required(),
  service: Joi.string().required(),
  url: Joi.string().allow(null).required(),
}).label("ProcessAddress");

const endpointAddressSchema = Joi.object({
  code: Joi.string().required(),
  service: Joi.string().required(),
  url: Joi.string().allow(null).required(),
}).label("EndpointAddress");

// The stored agreement definition as stored, with the rule it breaks when GAS
// cannot load it. Null when not stored, too large or the read failed.
// missingServiceUrls names the {SERVICE}_URL env vars whose absence stops GAS
// loading it here.
const agreementSchema = Joi.object({
  definition: Joi.object().unknown(true).required(),
  addresses: Joi.array().items(processAddressSchema).required(),
  endpointAddresses: Joi.array().items(endpointAddressSchema).required(),
  missingServiceUrls: Joi.array().items(Joi.string()).required(),
  problem: Joi.string().allow(null).required(),
})
  .allow(null)
  .required()
  .label("GrantVersionAgreement");

const pageSchema = (tab, keys, label) =>
  recordPageSchema(grantVersionHeaderSchema, tab, keys, label);

export const grantVersionPageSchemas = {
  overview: pageSchema(
    "overview",
    { overview: overviewSchema },
    "GrantVersionOverviewPage",
  ),
  definition: pageSchema(
    "definition",
    { definition: definitionSchema },
    "GrantVersionDefinitionPage",
  ),
  payment: pageSchema(
    "payment",
    { payment: paymentSchema },
    "GrantVersionPaymentPage",
  ),
  agreement: pageSchema(
    "agreement",
    { agreement: agreementSchema },
    "GrantVersionAgreementPage",
  ),
};
