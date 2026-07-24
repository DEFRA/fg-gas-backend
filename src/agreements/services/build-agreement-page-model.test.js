import { describe, expect, it } from "vitest";
import { AgreementDefinition } from "../models/agreement-definitions/agreement-definition.js";
import { buildAgreementPageModel } from "./build-agreement-page-model.js";

const definition = new AgreementDefinition({
  code: "test",
  configVersion: "1",
  agreementNumberPrefix: "TST",
  create: { target: "offered" },
  states: {
    offered: {
      page: "offer",
      on: {
        print: {
          target: "offered",
          validation: {
            page: "document",
            required: [
              {
                name: "confirm",
                value: "yes",
                href: "#confirm",
                message: "Confirm",
              },
            ],
          },
        },
      },
    },
  },
  pages: {
    offer: {
      title: "Offer",
      components: [{ component: "heading", text: "Agreement offer" }],
      actions: [],
    },
    document: {
      title: "Document",
      layout: "document",
      components: [{ component: "heading", text: "Document" }],
      actions: [{ name: "accept", method: "GET", text: "Accept", href: "/" }],
    },
  },
});
const agreement = {
  agreementNumber: "TST123",
  code: "test",
  clientRef: "client",
  configVersion: "1",
  identifiers: { sbi: "300000000" },
  state: "offered",
  version: 1,
};

describe("buildAgreementPageModel", () => {
  it("builds presentation from one Agreement", async () => {
    await expect(
      buildAgreementPageModel({
        agreement,
        agreementDefinition: definition,
        page: "offer",
        mode: "view",
      }),
    ).resolves.toEqual({
      agreement: {
        agreementNumber: "TST123",
        code: "test",
        clientRef: "client",
        identifiers: { sbi: "300000000" },
        state: "offered",
        version: 1,
      },
      page: { name: "offer", title: "Offer" },
      components: [{ component: "heading", text: "Agreement offer" }],
      actions: [],
    });
  });

  it("removes actions in print mode", async () => {
    const result = await buildAgreementPageModel({
      agreement,
      agreementDefinition: definition,
      page: "document",
      mode: "print",
    });
    expect(result.page.layout).toBe("document");
    expect(result.actions).toEqual([]);
  });
});
