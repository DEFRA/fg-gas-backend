import { describe, expect, it } from "vitest";
import { AgreementDefinition } from "../models/agreement-definitions/agreement-definition.js";
import { AgreementItem } from "../models/agreement-item.js";
import { AgreementReference } from "../models/agreement-reference.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import { CurrentAgreement } from "../models/current-agreement.js";
import { buildAgreementPageModel } from "./build-agreement-page-model.js";

const reference = new AgreementReference({
  agreementNumber: "PMF823153883",
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
});

const item = new AgreementItem({
  agreementCode: reference.code,
  clientRef: reference.clientRef,
  identifiers: { sbi: reference.sbi },
  configVersion: "0.0.1",
  state: "offered",
});

const snapshot = new Agreement({
  agreementNumber: reference.agreementNumber,
  code: reference.code,
  identifiers: { sbi: reference.sbi },
  items: [item],
});

const currentAgreement = new CurrentAgreement({
  reference,
  version: new AgreementVersion({
    agreementNumber: reference.agreementNumber,
    version: 2,
    snapshot,
  }),
});

const agreementDefinition = new AgreementDefinition({
  code: reference.code,
  configVersion: "0.0.1",
  agreementNumberPrefix: "PMF",
  create: { target: "offered", effects: [] },
  states: {
    offered: { page: "offered" },
  },
  pages: {
    offered: {
      title: "Review your agreement offer",
      components: [{ component: "heading", text: "Review" }],
      actions: [
        {
          name: "accept",
          method: "GET",
          text: "Continue",
          href: "#confirm",
        },
      ],
    },
  },
});

describe("buildAgreementPageModel", () => {
  it("builds the configured page model from the Current Agreement", async () => {
    await expect(
      buildAgreementPageModel({
        currentAgreement,
        agreementDefinition,
        page: "offered",
        mode: "view",
      }),
    ).resolves.toEqual({
      ...reference,
      state: "offered",
      page: {
        name: "offered",
        title: "Review your agreement offer",
      },
      components: [{ component: "heading", text: "Review" }],
      actions: [
        {
          name: "accept",
          method: "GET",
          text: "Continue",
          href: "#confirm",
        },
      ],
    });
  });

  it("returns configured document layout without interactive print actions", async () => {
    const documentDefinition = new AgreementDefinition({
      code: reference.code,
      configVersion: "0.0.1",
      agreementNumberPrefix: "PMF",
      create: { target: "offered", effects: [] },
      states: { offered: { page: "document" } },
      pages: {
        document: {
          title: "Agreement document",
          layout: "document",
          components: [{ component: "heading", text: "Agreement" }],
          actions: [
            {
              name: "accept",
              method: "POST",
              text: "Accept",
              href: "/accept",
            },
          ],
        },
      },
    });

    await expect(
      buildAgreementPageModel({
        currentAgreement,
        agreementDefinition: documentDefinition,
        page: "document",
        mode: "print",
      }),
    ).resolves.toMatchObject({
      page: {
        name: "document",
        title: "Agreement document",
        layout: "document",
      },
      actions: [],
    });
  });
});
