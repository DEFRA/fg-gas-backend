import { constants } from "node:http2";
import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  listQueryRequestSchema,
  listQueryResponseSchema,
} from "../schemas/list-query.schema.js";
import { callerOf } from "../services/request-caller.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";
import {
  SHELL_ALWAYS,
  SHELL_NOTES,
  shellPlugins,
} from "../services/shell-tag.js";
import { queryListUseCase } from "../use-cases/query-list.use-case.js";

const LABEL = "Query list";

// A POST, so a searched ref travels in the body and never in a logged URL.
export const queryListRoute = {
  method: "POST",
  path: "/grant-admin/lists/query",
  options: {
    description:
      "Admin: one list by its admin path and URL params, checked as its address, then its first page or pages 1 to `pages` read in turn under one deadline, a refused search read again without it",
    notes: SHELL_NOTES[SHELL_ALWAYS],
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: {
      headers: adminReadHeadersSchema,
      payload: listQueryRequestSchema,
      failAction: safeFailAction(LABEL),
    },
    response: {
      schema: listQueryResponseSchema,
      failAction: safeResponseFailAction(LABEL),
    },
    plugins: {
      ...shellPlugins(SHELL_ALWAYS),
      "hapi-swagger": {
        responses: {
          [constants.HTTP_STATUS_OK]: {
            description:
              "`list` is null when `read` is false; a later page that failed is `stopped`, the rows before it stand",
          },
          [constants.HTTP_STATUS_BAD_REQUEST]: {
            description:
              "`code` ADDRESS_REFUSED with `problems` (unknownKeys, repeatedKeys, unknownValues) and `bucket`; RANGE_REFUSED with `bucket`; or a query the list refuses, by `reason`",
          },
          [constants.HTTP_STATUS_NOT_FOUND]: {
            description: "`code` LIST_NOT_FOUND: no list has this path",
          },
          [constants.HTTP_STATUS_SERVICE_UNAVAILABLE]: {
            description:
              "`code` CW_UNREACHABLE: CW-BE's lists could not be read and the path is one it last listed, or it has never been read",
          },
          [constants.HTTP_STATUS_GATEWAY_TIMEOUT]: {
            description: "The first page did not finish in time",
          },
        },
      },
    },
  },
  handler: (request) =>
    queryListUseCase({
      ask: request.payload,
      caller: callerOf(request),
      actor: request.headers["x-actor"],
    }),
};
