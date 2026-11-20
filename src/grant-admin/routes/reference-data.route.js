import {
  addDbReferenceDataItem,
  changeDbReferenceDataItem,
  listGrantReferenceData,
  removeDbReferenceDataItem,
  viewGrantReferenceData,
} from "../../grants/services/reference-data.service.js";
import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import { allowListParamsSchema } from "../schemas/allow-list-params.schema.js";
import {
  addReferenceDataItemRequestSchema,
  changeReferenceDataItemRequestSchema,
  dbReferenceDataResponseSchema,
  grantReferenceDataResponseSchema,
  referenceDataItemParamsSchema,
  referenceDataParamsSchema,
  viewReferenceDataResponseSchema,
} from "../schemas/reference-data.schema.js";
import { findOperatorRoles } from "../services/operator-roles.js";
import { callerOf } from "../services/request-caller.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";

const LABEL = "Reference data";
const base = "/grant-admin/grants/{code}/reference-data";

const validate = (params, payload) => ({
  params,
  headers: adminReadHeadersSchema,
  ...(payload && { payload }),
  failAction: safeFailAction(LABEL),
});

const response = (schema) => ({
  schema,
  failAction: safeResponseFailAction(LABEL),
});

const argsOf = (request) => ({
  grantCode: request.params.code,
  name: request.params.name,
  caller: callerOf(request),
  findUserRoles: findOperatorRoles,
});

export const listReferenceDataRoute = {
  method: "GET",
  path: base,
  options: {
    description: "Admin: list the reference data a grant declares",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: validate(allowListParamsSchema),
    response: response(grantReferenceDataResponseSchema),
  },
  handler: (request) => listGrantReferenceData(argsOf(request)),
};

export const viewReferenceDataRoute = {
  method: "GET",
  path: `${base}/{name}`,
  options: {
    description:
      "Admin: view a reference data set's current items, fetching an endpoint set now",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: validate(referenceDataParamsSchema),
    response: response(viewReferenceDataResponseSchema),
  },
  handler: (request) => viewGrantReferenceData(argsOf(request)),
};

export const addDbReferenceDataItemRoute = {
  method: "POST",
  path: `${base}/{name}/items`,
  options: {
    description: "Admin: add an item to a db reference data set",
    tags: ["api"],
    validate: validate(
      referenceDataParamsSchema,
      addReferenceDataItemRequestSchema,
    ),
    response: response(dbReferenceDataResponseSchema),
  },
  handler: (request) =>
    addDbReferenceDataItem({ ...argsOf(request), item: request.payload }),
};

export const changeDbReferenceDataItemRoute = {
  method: "PUT",
  path: `${base}/{name}/items/{itemCode}`,
  options: {
    description:
      "Admin: change an item's description in a db reference data set",
    tags: ["api"],
    validate: validate(
      referenceDataItemParamsSchema,
      changeReferenceDataItemRequestSchema,
    ),
    response: response(dbReferenceDataResponseSchema),
  },
  handler: (request) =>
    changeDbReferenceDataItem({
      ...argsOf(request),
      itemCode: request.params.itemCode,
      item: request.payload,
    }),
};

export const removeDbReferenceDataItemRoute = {
  method: "DELETE",
  path: `${base}/{name}/items/{itemCode}`,
  options: {
    description: "Admin: remove an item from a db reference data set",
    tags: ["api"],
    validate: validate(referenceDataItemParamsSchema),
    response: response(dbReferenceDataResponseSchema),
  },
  handler: (request) =>
    removeDbReferenceDataItem({
      ...argsOf(request),
      itemCode: request.params.itemCode,
    }),
};
