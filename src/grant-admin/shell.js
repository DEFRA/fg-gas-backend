import { ADMIN_CLIENT } from "./admin-client.js";
import { readShell } from "./services/shell-cache.js";
import { SHELL_ERRORS } from "./services/shell-tag.js";

const BAD_REQUEST = 400;

const modeOf = (request) => request.route.settings.plugins.grantAdmin?.shell;

const deadlineOf = (request) => {
  const budgetMs = request.route.settings.plugins.grantAdmin.shellBudgetMs;

  return budgetMs === null ? null : request.info.received + budgetMs;
};

const isAdmin = (request) =>
  request.auth.isAuthenticated &&
  request.auth.credentials?.service === ADMIN_CLIENT;

// Runs after requireAdminClient, so only the admin's own requests start it.
export const startShell = (request, h) => {
  if (modeOf(request) && isAdmin(request)) {
    request.plugins.grantAdmin = { shell: readShell(deadlineOf(request)) };
  }

  return h.continue;
};

const statusOf = (response) =>
  response.isBoom ? response.output.statusCode : response.statusCode;

const isPlainObject = (value) =>
  value?.constructor === Object && typeof value === "object";

const isSuccess = (request) => statusOf(request.response) < BAD_REQUEST;

const skips = (request) =>
  modeOf(request) === SHELL_ERRORS && isSuccess(request);

const startedFor = (request) =>
  isAdmin(request) ? (request.plugins.grantAdmin?.shell ?? null) : null;

const wants = (request) => (skips(request) ? null : startedFor(request));

const withShell = (response, shell) => {
  if (response.isBoom) {
    response.output.payload.shell = shell;
    return;
  }

  if (isPlainObject(response.source)) {
    response.source = { ...response.source, shell };
  }
};

// After response validation, so no route schema names `shell`.
export const addShell = async (request, h) => {
  const started = wants(request);

  if (started === null) {
    return h.continue;
  }

  withShell(request.response, await started);

  return h.continue;
};
