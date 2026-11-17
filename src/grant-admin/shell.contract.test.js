import Boom from "@hapi/boom";
import hapi from "@hapi/hapi";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ADMIN_CLIENT } from "./admin-client.js";
import { grantAdmin } from "./index.js";
import { OVERVIEW_BUDGET_MS } from "./services/overview-reads.js";
import { readShell } from "./services/shell-cache.js";

vi.mock("../common/logger.js");
vi.mock("./services/shell-cache.js");

const SHELL = { catalogue: { buckets: [], sourceErrors: [] } };

const ALWAYS = [
  "get /grant-admin/clients/{service}",
  "get /grant-admin/events/{service}/{box}/{id}",
  "get /grant-admin/explore/vocabulary",
  "get /grant-admin/grants/{code}/applications/{clientRef}/events",
  "get /grant-admin/grants/{code}/applications/{clientRef}/overview",
  "get /grant-admin/grants/{code}/applications/{clientRef}/raw",
  "get /grant-admin/grants/{code}/versions/{version}/agreement",
  "get /grant-admin/grants/{code}/versions/{version}/definition",
  "get /grant-admin/grants/{code}/versions/{version}/entitlements",
  "get /grant-admin/grants/{code}/versions/{version}/events",
  "get /grant-admin/grants/{code}/versions/{version}/overview",
  "get /grant-admin/grants/{code}/versions/{version}/payment",
  "get /grant-admin/grants/{code}/versions/{version}/phases",
  "get /grant-admin/overview",
  "get /grant-admin/workflows/{code}/versions/{version}/definition",
  "get /grant-admin/workflows/{code}/versions/{version}/events",
  "get /grant-admin/workflows/{code}/versions/{version}/overview",
  "get /grant-admin/workflows/{code}/versions/{version}/phases",
  "get /grant-admin/workflows/{code}/versions/{version}/raw",
  "get /grant-admin/workflows/{workflowCode}/cases/{caseRef}/events",
  "get /grant-admin/workflows/{workflowCode}/cases/{caseRef}/overview",
  "get /grant-admin/workflows/{workflowCode}/cases/{caseRef}/raw",
  "post /grant-admin/clients/{service}/{clientId}/tokens",
  "post /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/rotate",
  "post /grant-admin/explore/query",
  "post /grant-admin/lists/query",
];

const ERRORS = [
  "delete /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}",
  "get /grant-admin/grants/{code}/versions",
  "get /grant-admin/workflows/{code}/versions",
  "post /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/revoke",
  "post /grant-admin/events/{service}/{box}/{id}/payload",
  "post /grant-admin/events/{service}/{box}/{id}/purge",
  "post /grant-admin/events/{service}/{box}/{id}/redrive",
  "post /grant-admin/grants/{code}/versions/{version}/fetch",
  "post /grant-admin/workflows/{code}/versions/{version}/fetch",
  "put /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/expiry",
];

const keyOf = ({ method, path }) => `${method} ${path}`;

const modeOf = (route) => route.settings.plugins.grantAdmin?.shell ?? null;

const urlOf = (path) => path.replaceAll(/\{[^}]+\}/g, "x");

// Each route answers as the test asks once the plugin's own onPostAuth exts
// have run, before its validation and handler and whatever its schema, so only the plugin's own shell ext decides what the answer carries.
const ANSWERS = new Map([
  ["ok", (h) => h.response({ answered: true }).takeover()],
  ["empty", (h) => h.response().code(204).takeover()],
  [
    "refused",
    () => {
      throw Boom.badRequest("refused");
    },
  ],
  [
    "failed",
    () => {
      throw Boom.badImplementation("failed");
    },
  ],
]);

// The answer the next injected request's route gives, set by the test.
let answering = null;

const buildServer = async () => {
  const server = hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (request, h) => {
      const service = request.headers["x-test-client"];

      return service
        ? h.authenticated({ credentials: { service } })
        : h.unauthenticated(Boom.unauthorized("no token"));
    },
  }));
  server.auth.strategy("service", "stub");
  server.auth.default("service");
  server.ext("onPostAuth", (_request, h) => answering?.(h) ?? h.continue, {
    after: ["grant-admin"],
  });
  await server.register(grantAdmin);
  await server.initialize();

  for (const route of server.table()) {
    route.settings.response.failAction = "ignore";
  }

  return server;
};

let server;
let routes;

beforeAll(async () => {
  server = await buildServer();
  routes = server.table();
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  readShell.mockResolvedValue(SHELL);
  answering = null;
});

const inject = (route, answer, client = ADMIN_CLIENT) => {
  answering = ANSWERS.get(answer);

  return server.inject({
    method: route.method,
    url: urlOf(route.path),
    headers: client ? { "x-test-client": client } : {},
  });
};

const routesIn = (keys) =>
  routes.filter((route) => keys.includes(keyOf(route)));

const untagged = () =>
  routes.filter((route) => ![...ALWAYS, ...ERRORS].includes(keyOf(route)));

describe("the shell each grant-admin route answers", () => {
  it("is tagged on exactly the routes the admin renders from", () => {
    expect(
      routes
        .filter((route) => modeOf(route) === "always")
        .map(keyOf)
        .sort(),
    ).toEqual(ALWAYS);
    expect(
      routes
        .filter((route) => modeOf(route) === "errors")
        .map(keyOf)
        .sort(),
    ).toEqual(ERRORS);
  });

  it("names the shell in the swagger notes of every tagged route", () => {
    for (const route of routesIn([...ALWAYS, ...ERRORS])) {
      expect(route.settings.notes).toContain("`shell:");
    }
  });

  describe.each(ALWAYS)("%s, tagged always", (key) => {
    const route = () => routesIn([key])[0];

    it.each(["ok", "refused", "failed"])(
      "answers it when %s",
      async (answer) => {
        const response = await inject(route(), answer);

        expect(response.result.shell).toEqual(SHELL);
      },
    );
  });

  describe.each(ERRORS)("%s, tagged errors", (key) => {
    const route = () => routesIn([key])[0];

    it.each(["refused", "failed"])("answers it when %s", async (answer) => {
      const response = await inject(route(), answer);

      expect(response.result.shell).toEqual(SHELL);
    });

    it.each(["ok", "empty"])("does not answer it when %s", async (answer) => {
      const response = await inject(route(), answer);

      expect(response.result?.shell).toBeUndefined();
    });
  });

  it.each(["ok", "refused", "failed"])(
    "is never answered by an untagged route when %s",
    async (answer) => {
      for (const route of untagged()) {
        const response = await inject(route, answer);

        expect(response.result?.shell).toBeUndefined();
      }
    },
  );

  it("is not answered to a request with no credential", async () => {
    for (const route of routesIn(ALWAYS)) {
      const response = await inject(route, "ok", null);

      expect(response.statusCode).toBe(401);
      expect(response.result.shell).toBeUndefined();
    }
  });

  it("is not answered to another service's client", async () => {
    for (const route of routesIn(ALWAYS)) {
      const response = await inject(route, "ok", "some-other-service");

      expect(response.statusCode).toBe(403);
      expect(response.result.shell).toBeUndefined();
    }
    expect(readShell).not.toHaveBeenCalled();
  });

  it("keeps an answer whole with a null shell when the catalogue cannot be built", async () => {
    readShell.mockResolvedValue(null);

    const response = await inject(routesIn(ALWAYS)[0], "ok");

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual({ answered: true, shell: null });
  });

  it("answers it on a request its route's own validation refuses", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/grant-admin/grants/x/versions",
      headers: { "x-test-client": ADMIN_CLIENT },
    });

    expect(response.statusCode).toBe(400);
    expect(response.result.shell).toEqual(SHELL);
  });

  it("leaves an answer with no body as it is", async () => {
    const response = await inject(routesIn(ALWAYS)[0], "empty");

    expect(response.statusCode).toBe(204);
    expect(response.payload).toBe("");
  });

  it("starts the catalogue read once per request, before the handler", async () => {
    await inject(routesIn(ALWAYS)[0], "ok");

    expect(readShell).toHaveBeenCalledTimes(1);
  });

  it("bounds the Overview's catalogue read by its budget from when it was received", async () => {
    const before = Date.now();
    await inject(routesIn(["get /grant-admin/overview"])[0], "ok");
    const after = Date.now();

    const [deadline] = readShell.mock.calls[0];

    expect(deadline).toBeGreaterThanOrEqual(before + OVERVIEW_BUDGET_MS);
    expect(deadline).toBeLessThanOrEqual(after + OVERVIEW_BUDGET_MS);
  });

  it("leaves other routes' catalogue reads to the catalogue's own timeouts", async () => {
    await inject(
      routesIn(["get /grant-admin/events/{service}/{box}/{id}"])[0],
      "ok",
    );

    expect(readShell).toHaveBeenCalledWith(null);
  });
});
