import Boom from "@hapi/boom";
import { checkPart } from "../../common/explore/large-answers.js";
import { parsePath } from "../../common/explore/paths.js";
import { sourcesSchema } from "../../common/explore/query-schema.js";
import { RESIDUAL_REASONS } from "../../common/explore/index-tests.js";
import { REFUSALS, refuseQuery } from "../../common/explore/refusal.js";
import { bodyOf, cwRequest, operatorHeaders } from "./cw-http.js";

const BAD_REQUEST = 400;
const TOO_MANY_REQUESTS = 429;
const EXPLORE_LABEL = "explore";
export const QUERY_INVALID = "EXPLORE_QUERY_INVALID";

const cwFailure = (reason) => {
  const error = Boom.badGateway(`CW-BE explore failed: ${reason}`);

  error.output.payload = { ...error.output.payload, hop: "CW-BE", reason };

  return error;
};

// Why Caseworking's read couldn't be exact, where it says and GAS knows it,
// and at which path; or what it had too many of, in plain words.
const pathOf = (path) => (parsePath(path) ? path : null);

const NOUN = /^[a-z][a-z ]{0,63}$/;

const nounOf = (noun) =>
  typeof noun === "string" && NOUN.test(noun) ? noun : null;

const detailOf = ({ why, path, noun } = {}) => {
  if (RESIDUAL_REASONS.includes(why)) {
    return { why, path: pathOf(path) };
  }

  return nounOf(noun) ? { why: null, path: null, noun } : null;
};

const byCw = (error) => Object.assign(error, { service: "CW" });

// Only the refusal's code, and its detail, are read from Caseworking's
// answer; GAS words the message itself.
const refused = (error) => {
  const { reason, refusal, detail } = bodyOf(error) ?? {};

  if (reason === QUERY_INVALID) {
    return cwFailure(QUERY_INVALID);
  }

  return REFUSALS.includes(refusal)
    ? byCw(refuseQuery(refusal, detailOf(detail)))
    : cwFailure("ERRORED");
};

const BUSY = ["BUSY", "FULL"];

// Busy with this operator's last query, or with as many as Caseworking runs.
const busyOf = (error) => {
  const { refusal } = bodyOf(error) ?? {};

  return BUSY.includes(refusal) ? refusal : "BUSY";
};

const EXPLORE_FAILURES = {
  [BAD_REQUEST]: refused,
  [TOO_MANY_REQUESTS]: (error) => byCw(refuseQuery(busyOf(error))),
  otherwise: () => new Error("CW-BE explore failed"),
};

// A failure with no answer of Caseworking's own says why it gave none.
const isAnswered = (error) =>
  Boolean(error.refusal) || Boolean(error.output?.payload.hop);

const asCwFailure = (error) => {
  throw isAnswered(error) ? error : cwFailure(error.cwReason ?? "ERRORED");
};

const readOrFail = (schema, payload) => {
  const { error, value } = schema.validate(payload, { allowUnknown: true });

  if (error) {
    throw cwFailure("ERRORED");
  }

  return value;
};

// What Caseworking can be asked: its sources.
export const findCwExploreSources = () =>
  cwRequest("get", "/actuators/explore/sources", EXPLORE_LABEL, {
    failures: EXPLORE_FAILURES,
  })
    .catch(asCwFailure)
    .then((payload) => readOrFail(sourcesSchema, payload));

// Caseworking's part of a query, which it audits itself. It reads for the
// time GAS has left, less a margin for the answer to come back.
const TIME_LEFT_HEADER = "x-explore-time-left-ms";
const MARGIN_MS = 500;

export const queryCwExplore = (query, { actor, timeLeftMs, signal }) => {
  if (timeLeftMs <= MARGIN_MS) {
    return Promise.reject(byCw(refuseQuery("TOO_SLOW")));
  }

  return cwRequest("post", "/actuators/explore/query", EXPLORE_LABEL, {
    body: query,
    failures: EXPLORE_FAILURES,
    timeout: timeLeftMs,
    signal,
    headers: {
      ...operatorHeaders({ actor }),
      [TIME_LEFT_HEADER]: String(timeLeftMs - MARGIN_MS),
    },
  })
    .catch(asCwFailure)
    .then((payload) =>
      checkPart(payload, { allowUnknown: true }).catch(() => {
        throw cwFailure("ERRORED");
      }),
    );
};

export const cwExploreFailure = cwFailure;
