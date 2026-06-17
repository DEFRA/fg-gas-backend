import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { invokeAgreementActionUseCase } from "../use-cases/invoke-agreement-action.use-case.js";
import { invokeAgreementPostActionRoute } from "./invoke-agreement-action.route.js";

vi.mock("../use-cases/invoke-agreement-action.use-case.js");

let server;

beforeAll(async () => {
  server = hapi.server();
  server.route(invokeAgreementPostActionRoute);
  await server.initialize();
});

afterAll(async () => {
  await server.stop();
});

describe("invokeAgreementPostActionRoute", () => {
  it("accepts an Agreement item and returns the next rendered page model", async () => {
    invokeAgreementActionUseCase.mockResolvedValue({
      source: "config",
      agreement: {
        agreementNumber: "PMF000000001",
        code: "pigs-might-fly",
        clientRef: "PMF-APP-001",
        status: "accepted",
      },
      page: {
        id: "accepted",
        title: "Agreement accepted",
      },
      components: [
        {
          component: "heading",
          level: 1,
          text: "Agreement accepted",
        },
      ],
    });

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/agreements/PMF000000001/actions/accept",
      payload: {
        code: "pigs-might-fly",
        clientRef: "PMF-APP-001",
        confirm: "confirmed",
        acceptedBy: "applicant",
      },
    });

    expect(statusCode).toBe(200);
    expect(result).toEqual({
      source: "config",
      agreement: {
        agreementNumber: "PMF000000001",
        code: "pigs-might-fly",
        clientRef: "PMF-APP-001",
        status: "accepted",
      },
      page: {
        id: "accepted",
        title: "Agreement accepted",
      },
      components: [
        {
          component: "heading",
          level: 1,
          text: "Agreement accepted",
        },
      ],
    });
    expect(invokeAgreementActionUseCase).toHaveBeenCalledWith({
      actionName: "accept",
      agreementNumber: "PMF000000001",
      payload: {
        code: "pigs-might-fly",
        clientRef: "PMF-APP-001",
        confirm: "confirmed",
        acceptedBy: "applicant",
      },
    });
  });

  it("returns a rendered validation page model when configured action validation fails", async () => {
    invokeAgreementActionUseCase.mockResolvedValue({
      source: "config",
      agreement: {
        agreementNumber: "PMF000000001",
        code: "pigs-might-fly",
        clientRef: "PMF-APP-001",
        status: "offered",
      },
      page: {
        id: "accept",
        title: "Accept your agreement offer",
      },
      components: [
        {
          component: "heading",
          level: 1,
          text: "Accept your agreement offer",
        },
      ],
      actions: [
        {
          action: "/PMF000000001/actions/accept",
          checkbox: {
            name: "confirm",
            value: "confirmed",
            text: "I confirm I have read the information in this section and accept this agreement offer.",
            errorMessage: {
              text: "Confirm this agreement offer before accepting it",
            },
          },
          fields: [
            { name: "code", value: "pigs-might-fly" },
            { name: "clientRef", value: "PMF-APP-001" },
          ],
          text: "Accept agreement offer",
        },
      ],
      errors: [
        {
          href: "#confirm",
          text: "Confirm this agreement offer before accepting it",
        },
      ],
    });

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/agreements/PMF000000001/actions/accept",
      payload: {
        code: "pigs-might-fly",
        clientRef: "PMF-APP-001",
        acceptedBy: "applicant",
      },
    });

    expect(statusCode).toBe(200);
    expect(result).toMatchObject({
      page: {
        id: "accept",
      },
      errors: [
        {
          href: "#confirm",
          text: "Confirm this agreement offer before accepting it",
        },
      ],
      actions: [
        {
          checkbox: {
            name: "confirm",
            errorMessage: {
              text: "Confirm this agreement offer before accepting it",
            },
          },
        },
      ],
    });
  });
});
