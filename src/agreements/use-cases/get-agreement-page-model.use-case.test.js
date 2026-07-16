import { beforeEach, describe, expect, it, vi } from "vitest";
import { findAgreementDefinition } from "../models/agreement-definitions/agreement-definition-registry.js";
import { AgreementItem } from "../models/agreement-item.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import {
  findByClientRefCodeAndSbi,
  findLatestVersionByAgreementNumber,
} from "../repositories/agreement.repository.js";
import { getAgreementPageModelUseCase } from "./get-agreement-page-model.use-case.js";

vi.mock("../models/agreement-definitions/agreement-definition-registry.js");
vi.mock("../repositories/agreement.repository.js");

const request = {
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
  page: "offered",
  mode: "view",
};

const item = new AgreementItem({
  agreementCode: request.code,
  clientRef: request.clientRef,
  identifiers: { sbi: request.sbi },
  configVersion: "0.0.1",
  state: "offered",
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
  states: { offered: { page: "offered" } },
  pages: {
    offered: {
      title: "Review your agreement offer",
      components: [{ component: "heading", text: "Review" }],
    },
  },
};

describe("getAgreementPageModelUseCase", () => {
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

  it("gets the requested Agreement Page Model", async () => {
    await expect(getAgreementPageModelUseCase(request)).resolves.toMatchObject({
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      state: "offered",
      page: {
        name: "offered",
        title: "Review your agreement offer",
        mode: "view",
      },
    });
  });
});
