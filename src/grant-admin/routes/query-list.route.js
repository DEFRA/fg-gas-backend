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
              "`list` is null when `read` is false; a later page that failed is `stopped`, the rows before it stand, and names its `queue` when one bucket of several failed. A list over several buckets, such as a service's events, reads them side by side and merges them newest first: its `cursor` holds each one's position, and `queues` says which bounded queue ended the page and which others have rows waiting",
          },
          [constants.HTTP_STATUS_BAD_REQUEST]: {
            description:
              "`code` ADDRESS_REFUSED with `problems` (unknownKeys, repeatedKeys, unknownValues) and `bucket`; RANGE_REFUSED with `bucket`; or a query the list refuses, by `reason`: INVALID_CURSOR for a cursor it cannot read, UNKNOWN_REF_KIND for a search kind it doesn't offer. A failed read of one bucket of several names its `queue`",
          },
          [constants.HTTP_STATUS_NOT_FOUND]: {
            description: "`code` LIST_NOT_FOUND: no list has this path",
          },
          [constants.HTTP_STATUS_SERVICE_UNAVAILABLE]: {
            description:
              "`code` CW_UNREACHABLE: CW-BE's lists could not be read and the path is one it last listed, or it has never been read; or CW-BE could not be reached for a first page of a list over several buckets. It names no `queue`",
          },
          [constants.HTTP_STATUS_GATEWAY_TIMEOUT]: {
            description:
              "The first page did not finish in time; one bucket of several names its `queue`",
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
