import Boom from "@hapi/boom";
import hapi from "@hapi/hapi";
import { describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { changeApiTokenExpiryUseCase } from "../use-cases/change-api-token-expiry.use-case.js";
import { deleteApiTokenUseCase } from "../use-cases/delete-api-token.use-case.js";
import { issueApiTokenUseCase } from "../use-cases/issue-api-token.use-case.js";
import { listApiTokensUseCase } from "../use-cases/list-api-tokens.use-case.js";
import { revokeApiTokenUseCase } from "../use-cases/revoke-api-token.use-case.js";
import { rotateApiTokenUseCase } from "../use-cases/rotate-api-token.use-case.js";
import {
  changeApiTokenExpiryRoute,
  deleteApiTokenRoute,
  issueApiTokenRoute,
  listApiTokensRoute,
  revokeApiTokenRoute,
  rotateApiTokenRoute,
} from "./api-clients.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/change-api-token-expiry.use-case.js");
vi.mock("../use-cases/delete-api-token.use-case.js");
vi.mock("../use-cases/rotate-api-token.use-case.js");
vi.mock("../use-cases/issue-api-token.use-case.js");
vi.mock("../use-cases/list-api-tokens.use-case.js");
vi.mock("../use-cases/revoke-api-token.use-case.js");

const TOKEN_ID = "6650c1f2a9e4b1d07c20bd91";
const HASH = "b".repeat(64);
const CALLER_HASH = "c".repeat(64);

const ROUTES = [
  listApiTokensRoute,
  issueApiTokenRoute,
  revokeApiTokenRoute,
  deleteApiTokenRoute,
  changeApiTokenExpiryRoute,
  rotateApiTokenRoute,
];

const requestOf = (params, extra = {}) => ({
  params,
  auth: {
    credentials: {
      service: "fg-grants-platform-admin",
      tokenHash: CALLER_HASH,
    },
  },
  headers: { "x-actor": "UTF-8''%C5%81ukasz", "x-actor-id": "x" },
  ...extra,
});

// The decoded name is GAS's and the audit's; Caseworking gets it as sent.
const reader = {
  caller: "fg-grants-platform-admin",
  callerHash: CALLER_HASH,
  actor: "Łukasz",
  encodedActor: "UTF-8''%C5%81ukasz",
};

const token = {
  tokenId: TOKEN_ID,
  clientId: "grants-ui",
  status: "ACTIVE",
  tokenHint: "wxyz",
  createdAt: new Date("2026-11-02T10:00:00.000Z"),
  createdBy: "Ann",
  expiresAt: null,
  revokedAt: null,
  revokedBy: null,
  inUse: false,
};

describe("API client routes", () => {
  it("are the client routes, each on the default service auth", () => {
    expect(ROUTES.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /grant-admin/clients/{service}",
      "POST /grant-admin/clients/{service}/{clientId}/tokens",
      "POST /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/revoke",
      "DELETE /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}",
      "PUT /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/expiry",
      "POST /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/rotate",
    ]);
    ROUTES.forEach((route) => expect(route.options.auth).toBeUndefined());
  });

  it.each(ROUTES.map((route) => [route.path, route]))(
    "%s names the operator and logs nothing it refuses",
    (_, route) => {
      const { validate } = route.options;

      expect(
        validate.headers.validate({ "x-actor": "Ann" }).error,
      ).toBeDefined();
      expect(validate.failAction).toBeTypeOf("function");
    },
  );

  const HEX_RUN = "0123456789abcdef".repeat(4);
  const OPERATOR_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const headersOf = (actor) => ({
    "x-actor": actor,
    "x-actor-id": OPERATOR_ID,
  });

  it.each(ROUTES.map((route) => [route.path, route]))(
    "%s accepts a name with shorter hex runs",
    (_, route) => {
      expect(
        route.options.validate.headers.validate(
          headersOf(`${HEX_RUN.slice(1)} ${HEX_RUN.slice(1)}`),
        ).error,
      ).toBeUndefined();
    },
  );

  it.each([
    ["64 hex characters", HEX_RUN],
    ["64 upper-case hex characters in a name", `Jo ${HEX_RUN.toUpperCase()}`],
    [
      "64 hex characters once decoded",
      `UTF-8''${[...HEX_RUN].map((c) => `%${c.charCodeAt(0).toString(16)}`).join("")}`,
    ],
  ])("refuses an operator name of %s, without echoing it", (_, actor) => {
    ROUTES.forEach((route) => {
      const { error } = route.options.validate.headers.validate(
        headersOf(actor),
      );

      expect(error).toBeDefined();
      expect(error.message).not.toContain(HEX_RUN);
    });
  });

  it.each([["payments"], ["caseworking"]])(
    "refuses the service %s",
    (service) => {
      expect(
        listApiTokensRoute.options.validate.params.validate({ service }).error,
      ).toBeDefined();
    },
  );

  it("refuses a token id that is not a 24-hex ObjectId", () => {
    expect(
      revokeApiTokenRoute.options.validate.params.validate({
        service: "gas",
        clientId: "grants-ui",
        tokenId: "../x",
      }).error,
    ).toBeDefined();
  });
});

// As GAS's own list builds it, in relaxed Extended JSON.
const stored = {
  _id: { $oid: TOKEN_ID },
  id: "bbb••••••bbb",
  clientId: "grants-ui",
  client: "grants-ui",
  tokenHint: "wxyz",
  expiresAt: null,
  createdAt: { $date: "2026-11-02T10:00:00.000Z" },
  createdBy: "Ann",
};

const listed = { ...token, stored };

describe("closed response schemas", () => {
  const { schema: listSchema } = listApiTokensRoute.options.response;
  const { schema: issuedSchema } = issueApiTokenRoute.options.response;

  it.each([
    ["the hash", { id: HASH }],
    ["seeded", { seeded: true }],
    ["an unknown status", { status: "PAUSED" }],
    ["the legacy client name", { client: "grants-ui" }],
  ])("refuses a token row with %s", (_, extra) => {
    expect(
      listSchema.validate({ service: "gas", tokens: [{ ...listed, ...extra }] })
        .error,
    ).toBeDefined();
  });

  it("requires inUse on every row", () => {
    const { inUse, ...withoutInUse } = listed;

    expect(
      listSchema.validate({ service: "gas", tokens: [withoutInUse] }).error,
    ).toBeDefined();
  });

  it("lists a nameless row with no name", () => {
    expect(
      listSchema.validate({
        service: "cw",
        tokens: [{ ...listed, clientId: null, tokenHint: null }],
      }).error,
    ).toBeUndefined();
  });

  it("requires the stored row on every listed row", () => {
    expect(
      listSchema.validate({ service: "gas", tokens: [token] }).error,
    ).toBeDefined();
  });

  it("lists the stored row with any field it has", () => {
    const row = { ...stored, revokedAt: { $date: "2026-11-03T10:00:00Z" } };

    expect(
      listSchema.validate({
        service: "gas",
        tokens: [{ ...listed, stored: { ...row, legacy: 1, note: "" } }],
      }).error,
    ).toBeUndefined();
  });

  it.each([
    ["an unmasked id", { id: HASH }],
    ["no id", { id: undefined }],
    ["a longer mask", { id: "bbbb••••••bbbb" }],
    ["a hash in another field", { tokenHash: HASH }],
    ["a hash inside a longer value", { note: `was ${HASH.toUpperCase()}` }],
    ["a nested document", { extra: { id: HASH } }],
    ["an array", { extra: [HASH] }],
    ["a hash as a key", { [HASH]: 1 }],
  ])("refuses a stored row with %s", (_, extra) => {
    expect(
      listSchema.validate({
        service: "gas",
        tokens: [{ ...listed, stored: { ...stored, ...extra } }],
      }).error,
    ).toBeDefined();
  });

  it("refuses an issued token that carries the hash", () => {
    expect(
      issuedSchema.validate({ service: "gas", token: { ...token, id: HASH } })
        .error,
    ).toBeDefined();
  });
});

describe("API client handlers", () => {
  it("list passes the service, the operator and the caller's hash", async () => {
    listApiTokensUseCase.mockResolvedValue("answer");

    expect(
      await listApiTokensRoute.handler(requestOf({ service: "gas" })),
    ).toBe("answer");
    expect(listApiTokensUseCase).toHaveBeenCalledWith({
      service: "gas",
      ...reader,
    });
  });

  it("issue answers 201 with the new token", async () => {
    issueApiTokenUseCase.mockResolvedValue("issued");
    const code = vi.fn().mockReturnValue("created");
    const h = { response: vi.fn().mockReturnValue({ code }) };

    const result = await issueApiTokenRoute.handler(
      requestOf(
        { service: "cw", clientId: "role-reader" },
        {
          payload: {
            tokenHash: HASH,
            tokenHint: "wxyz",
            expiresAt: null,
            newClient: true,
          },
        },
      ),
      h,
    );

    expect(issueApiTokenUseCase).toHaveBeenCalledWith({
      service: "cw",
      clientId: "role-reader",
      tokenHash: HASH,
      tokenHint: "wxyz",
      expiresAt: null,
      newClient: true,
      ...reader,
    });
    expect(h.response).toHaveBeenCalledWith("issued");
    expect(code).toHaveBeenCalledWith(201);
    expect(result).toBe("created");
  });

  it("issue takes only the hash, the hint and whether the client is new", () => {
    const { payload } = issueApiTokenRoute.options.validate;

    expect(
      payload.validate({ tokenHash: HASH, tokenHint: "wxyz" }).value,
    ).toEqual({
      tokenHash: HASH,
      tokenHint: "wxyz",
      expiresAt: null,
      newClient: false,
    });
    expect(
      payload.validate({
        tokenHash: HASH,
        tokenHint: "wxyz",
        expiresAt: "2027-01-01T00:00:00.000Z",
      }).value.expiresAt,
    ).toEqual(new Date("2027-01-01T00:00:00.000Z"));
    expect(payload.validate({ tokenHash: HASH }).error).toBeDefined();
    expect(
      payload.validate({ tokenHash: HASH, tokenHint: "wxyz", raw: "x" }).error,
    ).toBeDefined();
  });

  it("revoke answers 204", async () => {
    const code = vi.fn().mockReturnValue("no content");
    const h = { response: vi.fn().mockReturnValue({ code }) };

    await revokeApiTokenRoute.handler(
      requestOf({ service: "gas", clientId: "grants-ui", tokenId: TOKEN_ID }),
      h,
    );

    expect(revokeApiTokenUseCase).toHaveBeenCalledWith({
      service: "gas",
      clientId: "grants-ui",
      tokenId: TOKEN_ID,
      ...reader,
    });
    expect(code).toHaveBeenCalledWith(204);
  });

  it("delete answers 204", async () => {
    const code = vi.fn().mockReturnValue("no content");
    const h = { response: vi.fn().mockReturnValue({ code }) };
    const params = {
      service: "cw",
      clientId: "role-reader",
      tokenId: TOKEN_ID,
    };

    await deleteApiTokenRoute.handler(requestOf(params), h);

    expect(deleteApiTokenUseCase).toHaveBeenCalledWith({
      ...params,
      ...reader,
    });
    expect(code).toHaveBeenCalledWith(204);
  });

  it("change expiry answers the row alone, not its audit facts", async () => {
    changeApiTokenExpiryUseCase.mockResolvedValue({
      service: "gas",
      token,
      previousExpiresAt: null,
      revived: true,
    });
    const params = { service: "gas", clientId: "grants-ui", tokenId: TOKEN_ID };

    expect(
      await changeApiTokenExpiryRoute.handler(
        requestOf(params, { payload: { expiresAt: null } }),
      ),
    ).toEqual({ service: "gas", token });
    expect(changeApiTokenExpiryUseCase).toHaveBeenCalledWith({
      ...params,
      expiresAt: null,
      ...reader,
    });
    expect(
      changeApiTokenExpiryRoute.options.validate.payload.validate({}).error,
    ).toBeDefined();
  });

  it("rotate answers 201 with the new row", async () => {
    rotateApiTokenUseCase.mockResolvedValue({
      service: "gas",
      token,
      oldExpiresAt: new Date(),
    });
    const code = vi.fn().mockReturnValue("created");
    const h = { response: vi.fn().mockReturnValue({ code }) };
    const params = { service: "gas", clientId: "grants-ui", tokenId: TOKEN_ID };

    await rotateApiTokenRoute.handler(
      requestOf(params, {
        payload: { tokenHash: HASH, tokenHint: "wxyz", keepOld: "7d" },
      }),
      h,
    );

    expect(rotateApiTokenUseCase).toHaveBeenCalledWith({
      ...params,
      tokenHash: HASH,
      tokenHint: "wxyz",
      keepOld: "7d",
      ...reader,
    });
    expect(h.response).toHaveBeenCalledWith({ service: "gas", token });
    expect(code).toHaveBeenCalledWith(201);
  });

  it.each([["none"], ["24h"], ["7d"]])("rotate takes keepOld %s", (keepOld) => {
    expect(
      rotateApiTokenRoute.options.validate.payload.validate({
        tokenHash: HASH,
        tokenHint: "wxyz",
        keepOld,
      }).error,
    ).toBeUndefined();
  });

  it("rotate refuses any other overlap", () => {
    expect(
      rotateApiTokenRoute.options.validate.payload.validate({
        tokenHash: HASH,
        tokenHint: "wxyz",
        keepOld: "1h",
      }).error,
    ).toBeDefined();
  });
});

describe("refusals the owning service decides", () => {
  it("passes a 65-character name to the service's rule, which audits it", () => {
    expect(
      issueApiTokenRoute.options.validate.params.validate({
        service: "gas",
        clientId: "a".repeat(65),
      }).error,
    ).toBeUndefined();
  });

  it("passes an expiry that is not an ISO date on, for the service to refuse", () => {
    const { payload } = issueApiTokenRoute.options.validate;

    expect(
      payload.validate({
        tokenHash: HASH,
        tokenHint: "wxyz",
        expiresAt: "soon",
      }).value.expiresAt,
    ).toBe("soon");
    expect(
      changeApiTokenExpiryRoute.options.validate.payload.validate({
        expiresAt: "soon",
      }).error,
    ).toBeUndefined();
  });
});

describe("what a refused request logs", () => {
  const serverWith = async () => {
    const server = hapi.server();
    server.route(ROUTES);
    await server.initialize();
    return server;
  };

  const headers = {
    "x-actor": "Ann Operator",
    "x-actor-id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  };

  const everyLogLine = () =>
    JSON.stringify(
      ["debug", "info", "warn", "error"].map(
        (level) => logger[level].mock.calls,
      ),
    );

  it.each([
    [
      "an unknown body key",
      "/grant-admin/clients/gas/grants-ui/tokens",
      { tokenHash: HASH, tokenHint: "wxyz", raw: "the-raw-token" },
    ],
    [
      "an unknown overlap",
      `/grant-admin/clients/gas/grants-ui/tokens/${TOKEN_ID}/rotate`,
      { tokenHash: HASH, tokenHint: "wxyz", keepOld: "1h" },
    ],
  ])("logs no hash, hint or token for %s", async (_, url, payload) => {
    const server = await serverWith();

    const res = await server.inject({ method: "POST", url, headers, payload });

    expect(res.statusCode).toBe(400);
    expect(logger.warn).toHaveBeenCalled();
    expect(everyLogLine()).not.toContain(HASH);
    expect(everyLogLine()).not.toContain("wxyz");
    expect(everyLogLine()).not.toContain("the-raw-token");
    expect(res.payload).not.toContain(HASH);
  });

  it("refuses an operator name holding a hash before storing it", async () => {
    const hexRun = "0123456789abcdef".repeat(4);
    const server = await serverWith();

    const res = await server.inject({
      method: "POST",
      url: "/grant-admin/clients/gas/grants-ui/tokens",
      headers: { ...headers, "x-actor": `Jo ${hexRun}` },
      payload: { tokenHash: HASH, tokenHint: "wxyz" },
    });

    expect(res.statusCode).toBe(400);
    expect(issueApiTokenUseCase).not.toHaveBeenCalled();
    expect(res.payload).not.toContain(hexRun);
    expect(everyLogLine()).not.toContain(hexRun);
  });

  it("lists a stored row with its hash masked", async () => {
    listApiTokensUseCase.mockResolvedValue({
      service: "gas",
      tokens: [listed],
    });
    const server = await serverWith();

    const res = await server.inject({
      method: "GET",
      url: "/grant-admin/clients/gas",
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).tokens[0].stored.id).toBe("bbb••••••bbb");
  });

  it.each([
    ["an unmasked id", { id: HASH }],
    ["a hash in another field", { tokenHash: HASH }],
    ["a hash as a key", { [HASH]: HASH }],
  ])("answers 500 rather than list a stored row with %s", async (_, extra) => {
    listApiTokensUseCase.mockResolvedValue({
      service: "gas",
      tokens: [{ ...listed, stored: { ...stored, ...extra } }],
    });
    const server = await serverWith();

    const res = await server.inject({
      method: "GET",
      url: "/grant-admin/clients/gas",
      headers,
    });

    expect(res.statusCode).toBe(500);
    expect(res.payload).not.toContain(HASH);
    expect(everyLogLine()).not.toContain(HASH);
  });

  it("logs no hash or hint when the service refuses", async () => {
    const refusal = Boom.conflict("refused");
    refusal.output.payload.errorCode = "API_TOKEN_DUPLICATE";
    issueApiTokenUseCase.mockRejectedValue(refusal);
    const server = await serverWith();

    const res = await server.inject({
      method: "POST",
      url: "/grant-admin/clients/gas/grants-ui/tokens",
      headers,
      payload: { tokenHash: HASH, tokenHint: "wxyz" },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.payload).errorCode).toBe("API_TOKEN_DUPLICATE");
    expect(everyLogLine()).not.toContain(HASH);
    expect(everyLogLine()).not.toContain("wxyz");
  });
});
