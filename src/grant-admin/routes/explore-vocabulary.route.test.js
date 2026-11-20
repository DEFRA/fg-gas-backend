import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { exploreVocabularyUseCase } from "../use-cases/explore-vocabulary.use-case.js";
import { exploreVocabularyRoute } from "./explore-vocabulary.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/explore-vocabulary.use-case.js");

const VOCABULARY = {
  sources: [
    {
      name: "applications",
      label: "Applications",
      time: "createdAt",
      paths: [
        { path: "clientRef", type: "text", indexed: true },
        {
          path: "code",
          type: "text",
          indexed: true,
          values: [{ value: "frps-private-beta", label: "frps-private-beta" }],
        },
        { path: "phases.answers.applicant.business.name", indexed: false },
        {
          path: "phases.answers.agentDeclaration",
          type: "boolean",
          indexed: false,
        },
      ],
    },
  ],
};

describe("exploreVocabularyRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(exploreVocabularyRoute);
    await server.initialize();
  });

  afterAll(() => server.stop());

  it("answers the vocabulary, ignoring a roles header", async () => {
    exploreVocabularyUseCase.mockResolvedValue(VOCABULARY);

    const response = await server.inject({
      method: "GET",
      url: "/grant-admin/explore/vocabulary",
      headers: { "x-actor-roles": "r".repeat(2_001) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(VOCABULARY);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(exploreVocabularyUseCase).toHaveBeenCalledWith();
  });
});
