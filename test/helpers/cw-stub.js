import { createServer } from "node:http";
import { env } from "node:process";

// An in-process stand-in for fg-cw-backend's actuator endpoints (FGP-1227).
// It runs on the host in the vitest *global setup* process; GAS reaches it
// through `host.docker.internal` and the tests drive it over the control
// endpoints below from the *test* process. Everything about GAS's side of the
// contract - the bearer token, the query string, the response envelope, the
// failure modes - is therefore exercised over real HTTP.

const CONTROL_PATH = "/__control";
const REQUESTS_PATH = "/__requests";
const RESET_PATH = "/__reset";

const OK = 200;
const CONFLICT = 409;
const UNAUTHORIZED = 401;
const SERVER_ERROR = 500;
const NOT_FOUND = 404;

export const CW_STUB_TOKEN = "cw-stub-token";

const emptyBox = () => ({
  mode: "ok",
  data: [],
  pagination: {
    startCursor: null,
    endCursor: null,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  // Single-event control (FGP-1392 detail and redrive). `detail` is the whole
  // document GET /actuators/{box}/{id} answers with, `redrive` the list row
  // POST /actuators/{box}/{id}/redrive answers with; null means 404.
  // `redriveConflictStatus` makes the redrive answer 409 with that status,
  // exactly as the real actuator does for a row that is no longer DEAD_LETTER.
  detail: null,
  redrive: null,
  redriveConflictStatus: null,
  // Single-event park/unpark control (FGP-1392 UX4). `park`/`unpark` are the
  // list rows those endpoints answer with; null means 404.
  // `parkConflictStatus`/`unparkConflictStatus` make them answer 409 with that
  // status, exactly as the real actuator does for a row in the wrong status.
  park: null,
  unpark: null,
  parkConflictStatus: null,
  unparkConflictStatus: null,
  // Per-status counts control (FGP-1392 counts). What
  // GET /actuators/{box}/counts answers with; the six-key zero-fill is the
  // real actuator's job, so the stub answers with exactly what a test set.
  counts: {
    PUBLISHED: 0,
    PROCESSING: 0,
    FAILED: 0,
    RESUBMITTED: 0,
    COMPLETED: 0,
    DEAD_LETTER: 0,
    PARKED: 0,
  },
  // Failure-breakdown control (FGP-1392 UX4). What
  // GET /actuators/{box}/breakdown answers with; the merge, the display
  // shortening and the 20-group cap are all GAS's job, so the stub answers
  // with exactly what a test set - raw types included.
  groups: [],
});

const defaultState = () => ({ inbox: emptyBox(), outbox: emptyBox() });

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

  if (box.mode === "timeout") {
    // Never answers: GAS's wreck client gives up on its own timeout.
    return undefined;
  }

  return send(response, OK, { data: box.data, pagination: box.pagination });
};

// The request body is recorded as well as the query string: park sends its
// reason as a body and its actor as a query parameter, and the tests assert on
// both halves of that contract.
const record = async (name, request) => {
  const url = new URL(request.url, "http://stub.local");

  requests.push({
    box: name,
    method: request.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    authorization: request.headers.authorization ?? null,
    body: request.method === "POST" ? await readBody(request) : null,
  });
};

const isAuthorised = (request) =>
  request.headers.authorization === `Bearer ${token}`;

const handleActuator = async (name, request, response) => {
  await record(name, request);

  if (!isAuthorised(request)) {
    return send(response, UNAUTHORIZED, { message: "bad token" });
  }

  return respondForMode(state[name], response);
};

// GET /actuators/{box}/{id} - the whole document, payload included.
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

// GET /actuators/{box}/counts - per-status counts for the given filter.
// Routed BEFORE the /{id} detail path, exactly as the real actuator has to be:
// "counts" would otherwise be read as an event id.
const handleCounts = async (name, request, response) => {
  await record(name, request);

  if (!isAuthorised(request)) {
    return send(response, UNAUTHORIZED, { message: "bad token" });
  }

  const box = state[name];

  if (box.mode !== "ok") {
    return respondForMode(box, response);
  }

  return send(response, OK, { counts: box.counts });
};

// POST /actuators/{box}/{id}/redrive - one updated list row, or 409/404.
const handleRedrive = async (name, id, request, response) => {
  await record(name, request);

  if (!isAuthorised(request)) {
    return send(response, UNAUTHORIZED, { message: "bad token" });
  }

  const box = state[name];

  if (box.mode !== "ok") {
    return respondForMode(box, response);
  }

  if (box.redriveConflictStatus) {
    return send(response, CONFLICT, {
      statusCode: CONFLICT,
      error: "Conflict",
      message: `event is ${box.redriveConflictStatus}, not DEAD_LETTER`,
      status: box.redriveConflictStatus,
    });
  }

  if (!box.redrive) {
    return send(response, NOT_FOUND, { message: "Not found" });
  }

  return send(response, OK, { ...box.redrive, _id: id });
};

// GET /actuators/{box}/breakdown - the dead-letter failure groups for one box.
// Routed BEFORE the /{id} detail path, exactly as the real actuator has to be:
// "breakdown" would otherwise be read as an event id.
const handleBreakdown = async (name, request, response) => {
  await record(name, request);

  if (!isAuthorised(request)) {
    return send(response, UNAUTHORIZED, { message: "bad token" });
  }

  const box = state[name];

  if (box.mode !== "ok") {
    return respondForMode(box, response);
  }

  return send(response, OK, { groups: box.groups });
};

// POST /actuators/{box}/{id}/park and .../unpark - one updated list row, or
// 409/404, exactly as redrive answers.
const handleTransition = async (name, id, action, request, response) => {
  await record(name, request);

  if (!isAuthorised(request)) {
    return send(response, UNAUTHORIZED, { message: "bad token" });
  }

  const box = state[name];

  if (box.mode !== "ok") {
    return respondForMode(box, response);
  }

  const conflict = box[`${action}ConflictStatus`];

  if (conflict) {
    return send(response, CONFLICT, {
      statusCode: CONFLICT,
      error: "Conflict",
      message: `event is ${conflict}`,
      status: conflict,
    });
  }

  if (!box[action]) {
    return send(response, NOT_FOUND, { message: "Not found" });
  }

  return send(response, OK, { ...box[action], _id: id });
};

const COUNTS_PATH = /^\/actuators\/(inbox|outbox)\/counts$/;

const BREAKDOWN_PATH = /^\/actuators\/(inbox|outbox)\/breakdown$/;

const EVENT_PATH =
  /^\/actuators\/(inbox|outbox)\/([^/]+)(?:\/(redrive|park|unpark))?$/;

const TRANSITIONS = { park: "park", unpark: "unpark" };

const routeEvent = (pathname, request, response) => {
  const match = EVENT_PATH.exec(pathname);

  if (!match) {
    return null;
  }

  const [, name, id, action] = match;

  if (action === "redrive") {
    return handleRedrive(name, id, request, response);
  }

  if (TRANSITIONS[action]) {
    return handleTransition(name, id, action, request, response);
  }

  return handleDetail(name, id, request, response);
};

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

  if (pathname === "/actuators/inbox") {
    return handleActuator("inbox", request, response);
  }

  if (pathname === "/actuators/outbox") {
    return handleActuator("outbox", request, response);
  }

  const counts = COUNTS_PATH.exec(pathname);

  if (counts) {
    return handleCounts(counts[1], request, response);
  }

  const breakdown = BREAKDOWN_PATH.exec(pathname);

  if (breakdown) {
    return handleBreakdown(breakdown[1], request, response);
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
