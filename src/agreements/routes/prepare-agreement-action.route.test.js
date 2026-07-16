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
import { prepareAgreementActionUseCase } from "../use-cases/prepare-agreement-action.use-case.js";
import { prepareAgreementActionRoute } from "./prepare-agreement-action.route.js";

vi.mock("../use-cases/prepare-agreement-action.use-case.js");

const url =
  "/agreements/PMF823153883/actions/accept?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069";

const pageModel = {
  agreementNumber: "PMF823153883",
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
  state: "offered",
  page: {
    name: "accept",
    title: "Accept your agreement offer",
  },
  components: [],
  actions: [
    {
      name: "accept",
      method: "POST",
      href: "/agreements/PMF823153883/actions/accept",
      text: "Accept agreement offer",
    },
  ],
};

describe("prepareAgreementActionRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(prepareAgreementActionRoute);
    await server.initialize();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("prepares a named Agreement action", async () => {
    prepareAgreementActionUseCase.mockResolvedValue(pageModel);

    const { statusCode, result } = await server.inject({ method: "GET", url });

    expect(statusCode).toBe(200);
    expect(result).toEqual(pageModel);
    expect(prepareAgreementActionUseCase).toHaveBeenCalledWith({
      actionName: "accept",
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
    });
  });

  it("rejects an unavailable action", async () => {
    prepareAgreementActionUseCase.mockRejectedValue(
      Boom.conflict("Action is unavailable"),
    );

    const { statusCode } = await server.inject({ method: "GET", url });

    expect(statusCode).toBe(409);
  });

  it.each(["code", "clientRef", "sbi"])(
    "rejects a request without required identity field %s",
    async (field) => {
      const query = new URLSearchParams({
        code: "pigs-might-fly",
        clientRef: "xnp-rr3-nfa",
        sbi: "300000069",
      });
      query.delete(field);

      const { statusCode } = await server.inject({
        method: "GET",
        url: `/agreements/PMF823153883/actions/accept?${query}`,
      });

      expect(statusCode).toBe(400);
      expect(prepareAgreementActionUseCase).not.toHaveBeenCalled();
    },
  );
});
