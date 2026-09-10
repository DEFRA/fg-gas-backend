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
  // `detail` answers GET /actuators/events/{box}/{id}, `redrive` answers the
  // redrive POST; null means 404. `redriveConflictStatus` makes the redrive
  // answer 409 with that status, as the real actuator does for a row that is
  // no longer DEAD_LETTER.
  detail: null,
  redrive: null,
  redriveConflictStatus: null,
  // The six-key zero-fill is the real actuator's job, so the stub answers
  // with exactly what a test set.
  counts: {
    PUBLISHED: 0,
    PROCESSING: 0,
    FAILED: 0,
    RESUBMITTED: 0,
    COMPLETED: 0,
    DEAD_LETTER: 0,
  },
  // The merge, the display shortening and the 20-group cap are all GAS's
  // job, so the stub answers with exactly what a test set - raw types
  // included.
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

// The request body is recorded as well as the query string, so a test can
// assert that a redrive sends its actor and nothing else.
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

// GET /actuators/events - both boxes in one answer, assembled from the same
// per-box control the other endpoints use, so the stub holds one idea of what
// a box contains. A failure mode on either box fails the whole request (there
// is only one request to fail); the `unreadable` mode is the per-box
// exception - a 200 with that box's sections null, Caseworking's own
// per-section degradation.
const UNREADABLE = "unreadable";

const toPageSection = (box) =>
  box.mode === UNREADABLE
    ? { events: null, pagination: null, counts: null, breakdown: null }
    : {
        events: box.data,
        pagination: box.pagination,
        counts: box.counts,
        breakdown: { groups: box.groups },
      };

const isWholeRequestFailure = (box) =>
  box.mode !== "ok" && box.mode !== UNREADABLE;

const handlePage = async (request, response) => {
  await record("page", request);

  if (!isAuthorised(request)) {
    return send(response, UNAUTHORIZED, { message: "bad token" });
  }

  const failing = [state.inbox, state.outbox].find(isWholeRequestFailure);

  if (failing) {
    return respondForMode(failing, response);
  }

  return send(response, OK, {
    inbox: toPageSection(state.inbox),
    outbox: toPageSection(state.outbox),
    sectionErrors: [],
  });
};

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

// POST /actuators/events/{box}/{id}/redrive - one updated list row, or 409/404.
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

const EVENT_PATH =
  /^\/actuators\/events\/(inbox|outbox)\/([^/]+)(?:\/(redrive))?$/;

const routeEvent = (pathname, request, response) => {
  const match = EVENT_PATH.exec(pathname);

  if (!match) {
    return null;
  }

  const [, name, id, action] = match;

  if (action === "redrive") {
    return handleRedrive(name, id, request, response);
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

  if (pathname === "/actuators/events") {
    return handlePage(request, response);
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
