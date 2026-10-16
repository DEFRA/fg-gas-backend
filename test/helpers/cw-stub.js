import { createServer } from "node:http";
import { env } from "node:process";

// A stand-in for fg-cw-backend's actuator endpoints, reached by GAS over real
// HTTP (`host.docker.internal`) and driven by the tests over its control paths.

const CONTROL_PATH = "/__control";
const REQUESTS_PATH = "/__requests";
const RESET_PATH = "/__reset";

const OK = 200;
const BAD_REQUEST = 400;
const NO_CONTENT = 204;
const CONFLICT = 409;
const PRECONDITION_FAILED = 412;
const UNPROCESSABLE = 422;
const UNAUTHORIZED = 401;
const SERVER_ERROR = 500;
const NOT_FOUND = 404;

export const CW_STUB_TOKEN = "cw-stub-token";

const emptyBox = () => ({
  mode: "ok",
  // A null `detail` or a false `redrive`/`purge` is a 404; a conflict status
  // is a 409.
  detail: null,
  redrive: false,
  redriveConflictStatus: null,
  purge: false,
  purgeConflictStatus: null,
  // An edit answers `edit` as its 200 body, or 404 when it is null; a stale
  // revision is a 412 and a refusal reason a 422.
  edit: null,
  editConflictStatus: null,
  editStale: false,
  editRefusal: null,
});

// The case actuators: `records` are the cases C2 and C3 know by
// "workflowCode/caseRef". `mode` fails every case route the way a
// box's does; `missingRoute` answers a bare 404, as a Caseworking without them.
const emptyCases = () => ({
  mode: "ok",
  missingRoute: false,
  records: {},
});

// The bucket routes: `entries` is the catalogue and `answers` each bucket's
// query answer by id. A `refusal` reason answers every query 400; a bucket
// with no answer is a 404 UNKNOWN_BUCKET.
const emptyBuckets = () => ({
  mode: "ok",
  missingRoute: false,
  entries: [],
  answers: {},
  timeline: { buckets: [] },
  refusal: null,
});

const defaultState = () => ({
  inbox: emptyBox(),
  outbox: emptyBox(),
  cases: emptyCases(),
  buckets: emptyBuckets(),
});

let server;
let token;
let state = defaultState();
let requests = [];

const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      resolve(raw ? JSON.parse(raw) : {});
    });
  });

const send = (response, statusCode, body) => {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const handleControl = async (request, response) => {
  const patch = await readBody(request);

  state = {
    inbox: { ...state.inbox, ...(patch.inbox ?? {}) },
    outbox: { ...state.outbox, ...(patch.outbox ?? {}) },
    cases: { ...state.cases, ...(patch.cases ?? {}) },
    buckets: { ...state.buckets, ...(patch.buckets ?? {}) },
  };

  send(response, OK, { ok: true });
};

const handleReset = (response) => {
  state = defaultState();
  requests = [];
  send(response, OK, { ok: true });
};

const respondForMode = (box, response) => {
  if (box.mode === "unauthorized") {
    return send(response, UNAUTHORIZED, { message: "SECRET-CW-401-BODY" });
  }

  if (box.mode === "error") {
    return send(response, SERVER_ERROR, { message: "SECRET-CW-500-BODY" });
  }

  if (box.mode === "down") {
    return response.destroy();
  }

  // "timeout" never answers: GAS's wreck client gives up on its own timeout.
  return undefined;
};

const record = async (name, request) => {
  const url = new URL(request.url, "http://stub.local");

  requests.push({
    box: name,
    method: request.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    authorization: request.headers.authorization ?? null,
    actorId: request.headers["x-actor-id"] ?? null,
    actor: request.headers["x-actor"] ?? null,
    searchRepeat: request.headers["x-search-repeat"] ?? null,
    body: request.method === "POST" ? await readBody(request) : null,
  });
};

const isAuthorised = (request) =>
  request.headers.authorization === `Bearer ${token}`;

// GET /actuators/events/{box}/{id} - the whole document, payload included.
const handleDetail = async (name, id, request, response) => {
  await record(name, request);

  if (!isAuthorised(request)) {
    return send(response, UNAUTHORIZED, { message: "bad token" });
  }

  const box = state[name];

  if (box.mode !== "ok") {
    return respondForMode(box, response);
  }

  if (!box.detail) {
    return send(response, NOT_FOUND, { message: "Not found" });
  }

  return send(response, OK, { ...box.detail, _id: id });
};

const conflict = (response, status, required) =>
  send(response, CONFLICT, {
    statusCode: CONFLICT,
    error: "Conflict",
    message: `event is ${status}, not ${required}`,
    status,
  });

// POST /actuators/events/{box}/{id}/{redrive|purge}: 204, 409 or 404. Both
// real routes answer the same way, so one handler serves both.
const handleAction = async (
  name,
  request,
  response,
  { allowed, conflictStatus, required },
) => {
  await record(name, request);

  if (!isAuthorised(request)) {
    return send(response, UNAUTHORIZED, { message: "bad token" });
  }

  const box = state[name];

  if (box.mode !== "ok") {
    return respondForMode(box, response);
  }

  if (box[conflictStatus]) {
    return conflict(response, box[conflictStatus], required);
  }

  if (!box[allowed]) {
    return send(response, NOT_FOUND, { message: "Not found" });
  }

  response.writeHead(NO_CONTENT);
  return response.end();
};

// A redrive may start from a purged row too; a purge may not.
const ACTIONS = {
  redrive: {
    allowed: "redrive",
    conflictStatus: "redriveConflictStatus",
    required: "redrivable (DEAD_LETTER or PURGED)",
  },
  purge: {
    allowed: "purge",
    conflictStatus: "purgeConflictStatus",
    required: "DEAD_LETTER",
  },
};

const refuseEdit = (response, box) => {
  if (box.editConflictStatus) {
    return conflict(
      response,
      box.editConflictStatus,
      "redrivable (DEAD_LETTER or PURGED)",
    );
  }

  if (box.editStale) {
    return send(response, PRECONDITION_FAILED, {
      statusCode: PRECONDITION_FAILED,
      error: "Precondition Failed",
      message: "event was edited since the revision given",
    });
  }

  return send(response, UNPROCESSABLE, {
    statusCode: UNPROCESSABLE,
    error: "Unprocessable Entity",
    message: "Payload refused",
    reason: box.editRefusal,
  });
};

const isEditRefused = (box) =>
  Boolean(box.editConflictStatus || box.editStale || box.editRefusal);

// POST /actuators/events/{box}/{id}/payload: 200 with what changed, or 404,
// 409, 412 or 422.
const handleEdit = async (name, request, response) => {
  await record(name, request);

  if (!isAuthorised(request)) {
    return send(response, UNAUTHORIZED, { message: "bad token" });
  }

  const box = state[name];

  if (box.mode !== "ok") {
    return respondForMode(box, response);
  }

  if (isEditRefused(box)) {
    return refuseEdit(response, box);
  }

  if (!box.edit) {
    return send(response, NOT_FOUND, { message: "Not found" });
  }

  return send(response, OK, box.edit);
};

const EVENT_PATH =
  /^\/actuators\/events\/(inbox|outbox)\/([^/]+)(?:\/(redrive|purge|payload))?$/;

const routeEvent = (pathname, request, response) => {
  const match = EVENT_PATH.exec(pathname);

  if (!match) {
    return null;
  }

  const [, name, id, action] = match;

  if (action === "payload") {
    return handleEdit(name, request, response);
  }

  if (action) {
    return handleAction(name, request, response, ACTIONS[action]);
  }

  return handleDetail(name, id, request, response);
};

const CASE_PATH = /^\/actuators\/cases\/([^/]+)\/([^/]+?)(\/existence)?$/;

const caseNotFound = (response) =>
  send(response, NOT_FOUND, {
    statusCode: NOT_FOUND,
    error: "Not Found",
    message: "Case not found",
    reason: "CASE_NOT_FOUND",
  });

const withDocument = (found, url) =>
  url.searchParams.get("include") === "document"
    ? found
    : { case: found.case, storedBytes: found.storedBytes };

// GET /actuators/cases/{workflowCode}/{caseRef} and its /existence.
const handleCases = async (pathname, request, response) => {
  await record("cases", request);

  if (!isAuthorised(request)) {
    return send(response, UNAUTHORIZED, { message: "bad token" });
  }

  const { cases } = state;

  if (cases.mode !== "ok") {
    return respondForMode(cases, response);
  }

  if (cases.missingRoute) {
    return send(response, NOT_FOUND, { message: "Not Found" });
  }

  const [, workflowCode, caseRef, existence] = CASE_PATH.exec(pathname);
  const found = cases.records[`${workflowCode}/${caseRef}`];

  if (existence) {
    return send(response, OK, { exists: Boolean(found) });
  }

  return found
    ? send(
        response,
        OK,
        withDocument(found, new URL(request.url, "http://stub.local")),
      )
    : caseNotFound(response);
};

const BUCKETS_PATH = "/actuators/buckets";
const BUCKET_QUERY_PATH = /^\/actuators\/buckets\/([^/]+)\/query$/;
const TIMELINE_PATH = "/actuators/timeline";

const answerBucketQuery = (pathname, response) => {
  const { answers, refusal } = state.buckets;
  const [, bucketId] = BUCKET_QUERY_PATH.exec(pathname);
  const answer = answers[decodeURIComponent(bucketId)];

  if (refusal) {
    return send(response, BAD_REQUEST, {
      reason: refusal,
      message: "SECRET-CW-REFUSAL",
    });
  }

  return answer
    ? send(response, OK, answer)
    : send(response, NOT_FOUND, { reason: "UNKNOWN_BUCKET" });
};

const answerBuckets = (pathname, buckets, response) =>
  pathname === BUCKETS_PATH
    ? send(response, OK, { buckets: buckets.entries })
    : answerBucketQuery(pathname, response);

// GET /actuators/buckets, POST /actuators/buckets/{bucketId}/query and
// POST /actuators/timeline.
const handleBuckets = async (pathname, request, response) => {
  await record("buckets", request);

  if (!isAuthorised(request)) {
    return send(response, UNAUTHORIZED, { message: "bad token" });
  }

  const { buckets } = state;

  if (buckets.mode !== "ok") {
    return respondForMode(buckets, response);
  }

  if (buckets.missingRoute) {
    return send(response, NOT_FOUND, { message: "Not Found" });
  }

  return pathname === TIMELINE_PATH
    ? send(response, OK, buckets.timeline)
    : answerBuckets(pathname, buckets, response);
};

const isBucketPath = (pathname) =>
  [BUCKETS_PATH, TIMELINE_PATH].includes(pathname) ||
  BUCKET_QUERY_PATH.test(pathname);

const route = async (request, response) => {
  const { pathname } = new URL(request.url, "http://stub.local");

  if (pathname === CONTROL_PATH) {
    return handleControl(request, response);
  }

  if (pathname === RESET_PATH) {
    return handleReset(response);
  }

  if (pathname === REQUESTS_PATH) {
    return send(response, OK, { requests });
  }

  if (isBucketPath(pathname)) {
    return handleBuckets(pathname, request, response);
  }

  if (CASE_PATH.test(pathname)) {
    return handleCases(pathname, request, response);
  }

  if (EVENT_PATH.test(pathname)) {
    return routeEvent(pathname, request, response);
  }

  return send(response, NOT_FOUND, { message: "Not found" });
};

export const startCwStub = (port, bearerToken) =>
  new Promise((resolve, reject) => {
    token = bearerToken;

    server = createServer((request, response) => {
      route(request, response).catch(() =>
        send(response, SERVER_ERROR, { message: "stub failure" }),
      );
    });
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

export const stopCwStub = () =>
  new Promise((resolve, reject) => {
    if (!server?.listening) {
      resolve();
      return;
    }

    server.closeAllConnections?.();
    server.close((error) => (error ? reject(error) : resolve()));
  });

// ---- control client, used from the test process ----

const controlUrl = (path) => `http://127.0.0.1:${env.CW_STUB_PORT}${path}`;

const call = async (path, options = {}) => {
  const response = await fetch(controlUrl(path), options);

  return response.json();
};

export const resetCwStub = () => call(RESET_PATH, { method: "POST" });

export const setCwStub = (patch) =>
  call(CONTROL_PATH, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });

export const cwStubRequests = async () => (await call(REQUESTS_PATH)).requests;
