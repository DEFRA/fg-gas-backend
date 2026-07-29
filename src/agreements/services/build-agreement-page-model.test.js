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
  identifiers: {
    sbi: "300000000",
    frn: "1000000000",
    crn: "1100000000",
  },
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

  it("resolves a template from the definition against the agreement", async () => {
    const templateDefinition = new AgreementDefinition({
      code: "test",
      configVersion: "1",
      agreementNumberPrefix: "TST",
      create: { target: "offered" },
      states: { offered: { page: "offer" } },
      templates: {
        stateSummary: {
          offered: {
            content: [{ component: "status", text: "Draft agreement" }],
          },
        },
      },
      pages: {
        offer: {
          title: "Offer",
          components: [
            {
              component: "template",
              templateRef: "$.definition.templates.stateSummary",
              templateKey: "$.agreement.state",
            },
          ],
          actions: [],
        },
      },
    });

    await expect(
      buildAgreementPageModel({
        agreement,
        agreementDefinition: templateDefinition,
        page: "offer",
        mode: "view",
      }),
    ).resolves.toMatchObject({
      components: [{ component: "status", text: "Draft agreement" }],
    });
  });

  it("returns a controlled internal error, naming the page and agreement but not agreement data, when a valid definition cannot be resolved", async () => {
    const unresolvableDefinition = new AgreementDefinition({
      code: "test",
      configVersion: "1",
      agreementNumberPrefix: "TST",
      create: { target: "offered" },
      states: { offered: { page: "offer" } },
      pages: {
        offer: {
          title: "Offer",
          components: [
            { component: "paragraph", text: "$.agreement.doesNotExist" },
          ],
          actions: [],
        },
      },
    });

    const error = await buildAgreementPageModel({
      agreement,
      agreementDefinition: unresolvableDefinition,
      page: "offer",
      mode: "view",
    }).catch((thrown) => thrown);

    expect(error.isBoom).toBe(true);
    expect(error.output.statusCode).toBe(500);
    expect(error.message).toBe(
      'Unable to build page model "offer" for agreement "TST123"',
    );
    expect(error.message).not.toContain(agreement.identifiers.sbi);
  });
});
