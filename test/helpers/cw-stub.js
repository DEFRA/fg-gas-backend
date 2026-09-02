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

const handleActuator = (name, request, response) => {
  const url = new URL(request.url, "http://stub.local");

  requests.push({
    box: name,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    authorization: request.headers.authorization ?? null,
  });

  if (request.headers.authorization !== `Bearer ${token}`) {
    return send(response, UNAUTHORIZED, { message: "bad token" });
  }

  return respondForMode(state[name], response);
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
