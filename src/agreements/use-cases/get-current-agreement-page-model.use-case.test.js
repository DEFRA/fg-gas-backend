import { beforeEach, describe, expect, it, vi } from "vitest";
import { findAgreementDefinition } from "../models/agreement-definitions/agreement-definition-registry.js";
import { AgreementItem } from "../models/agreement-item.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import {
  findByClientRefCodeAndSbi,
  findLatestVersionByAgreementNumber,
} from "../repositories/agreement.repository.js";
import { getCurrentAgreementPageModelUseCase } from "./get-current-agreement-page-model.use-case.js";

vi.mock("../models/agreement-definitions/agreement-definition-registry.js");
vi.mock("../repositories/agreement.repository.js");

const request = {
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
};

const item = new AgreementItem({
  agreementCode: request.code,
  clientRef: request.clientRef,
  identifiers: { sbi: request.sbi },
  configVersion: "0.0.1",
  state: "accepted",
});

const agreement = new Agreement({
  agreementNumber: "PMF823153883",
  code: request.code,
  identifiers: { sbi: request.sbi },
  items: [item],
});

const definition = {
  code: request.code,
  configVersion: "0.0.1",
  agreementNumberPrefix: "PMF",
  create: { target: "offered", effects: [] },
  states: {
    offered: { page: "offered" },
    accepted: { page: "active-agreement" },
  },
  pages: {
    offered: {
      title: "Agreement offer",
      components: [{ component: "heading", text: "Offer" }],
    },
    "active-agreement": {
      title: "Your agreement is active",
      components: [{ component: "heading", text: "Active" }],
    },
  },
};

describe("getCurrentAgreementPageModelUseCase", () => {
  beforeEach(() => {
    findByClientRefCodeAndSbi.mockResolvedValue(agreement);
    findLatestVersionByAgreementNumber.mockResolvedValue(
      new AgreementVersion({
        agreementNumber: agreement.agreementNumber,
        version: 2,
        snapshot: agreement,
      }),
    );
    findAgreementDefinition.mockReturnValue(definition);
  });

  it("gets the page selected by the latest lifecycle state", async () => {
    await expect(
      getCurrentAgreementPageModelUseCase(request),
    ).resolves.toMatchObject({
      agreementNumber: "PMF823153883",
      state: "accepted",
      page: {
        name: "active-agreement",
        title: "Your agreement is active",
        mode: "view",
      },
    });
  });
});
