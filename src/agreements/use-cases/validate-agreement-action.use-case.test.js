import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgreementAction } from "../models/agreement-action.js";
import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import { InvalidAgreementTransitionError } from "../models/invalid-agreement-transition.error.js";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { loadCurrentAgreement } from "./load-current-agreement.js";
import { validateAgreementActionUseCase } from "./validate-agreement-action.use-case.js";

vi.mock("../models/agreement-definitions/agreement-definition-loader.js");
vi.mock("../services/build-agreement-page-model.js");
vi.mock("./load-current-agreement.js");

const request = {
  agreementNumber: "PMF823153883",
  actionName: "accept",
  reference: {
    code: "pigs-might-fly",
    clientRef: "xnp-rr3-nfa",
    sbi: "300000069",
  },
  values: { confirm: "confirmed" },
};

const currentAgreement = {
  agreementNumber: request.agreementNumber,
  code: request.reference.code,
  definitionVersion: "0.0.1",
  state: "offered",
  reference: {
    agreementNumber: request.agreementNumber,
    code: request.reference.code,
    clientRef: request.reference.clientRef,
    sbi: request.reference.sbi,
  },
  version: { version: 2, snapshot: {} },
  item: {
    agreementCode: request.reference.code,
    clientRef: request.reference.clientRef,
    identifiers: { sbi: request.reference.sbi },
    configVersion: "0.0.1",
    state: "offered",
  },
};

const acceptAction = new AgreementAction({
  from: "offered",
  name: "accept",
  target: "accepted",
  validation: {
    page: "accept",
    required: [
      {
        name: "confirm",
        value: "confirmed",
        href: "#confirm",
        message: "Confirm this agreement offer before accepting it",
      },
    ],
  },
});

const agreementDefinition = {
  resolveAction: vi.fn(),
};

describe("validateAgreementActionUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCurrentAgreement.mockResolvedValue(currentAgreement);
    loadAgreementDefinition.mockResolvedValue(agreementDefinition);
    agreementDefinition.resolveAction.mockReturnValue(acceptAction);
  });

  it("returns the configured transition when validation succeeds", async () => {
    await expect(validateAgreementActionUseCase(request)).resolves.toEqual({
      valid: true,
      transition: {
        from: "offered",
        action: "accept",
        target: "accepted",
      },
    });

    expect(loadCurrentAgreement).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
    });
    expect(loadAgreementDefinition).toHaveBeenCalledOnce();
    expect(loadAgreementDefinition).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      configVersion: "0.0.1",
    });
    expect(agreementDefinition.resolveAction).toHaveBeenCalledWith({
      state: "offered",
      action: "accept",
    });
    expect(buildAgreementPageModel).not.toHaveBeenCalled();
  });

  it("validates action values independently from Agreement reference fields", async () => {
    const identityNamedAction = new AgreementAction({
      from: "offered",
      name: "accept",
      target: "accepted",
      validation: {
        page: "accept",
        required: [
          {
            name: "code",
            value: "configured-action-code",
            href: "#code",
            message: "Provide the configured action value",
          },
        ],
      },
    });
    agreementDefinition.resolveAction.mockReturnValue(identityNamedAction);

    await expect(
      validateAgreementActionUseCase({
        ...request,
        values: { code: "configured-action-code" },
      }),
    ).resolves.toEqual({
      valid: true,
      transition: {
        from: "offered",
        action: "accept",
        target: "accepted",
      },
    });

    expect(buildAgreementPageModel).not.toHaveBeenCalled();
  });

  it("returns the configured validation page with exact field errors", async () => {
    const pageModel = {
      ...currentAgreement.reference,
      state: "offered",
      page: {
        name: "accept",
        title: "Accept your agreement offer",
        mode: "view",
      },
      components: [],
      actions: [],
    };
    buildAgreementPageModel.mockResolvedValue(pageModel);

    await expect(
      validateAgreementActionUseCase({
        ...request,
        values: { ...request.values, confirm: undefined },
      }),
    ).resolves.toEqual({
      ...pageModel,
      errors: [
        {
          name: "confirm",
          href: "#confirm",
          message: "Confirm this agreement offer before accepting it",
        },
      ],
    });

    expect(buildAgreementPageModel).toHaveBeenCalledWith({
      currentAgreement,
      agreementDefinition,
      page: "accept",
      mode: "view",
    });
    expect(loadAgreementDefinition).toHaveBeenCalledOnce();
  });

  it("maps an unsupported action to a specific conflict", async () => {
    agreementDefinition.resolveAction.mockImplementation(() => {
      throw new InvalidAgreementTransitionError({
        from: "offered",
        action: "decline",
        availableActions: ["accept"],
      });
    });

    await expect(
      validateAgreementActionUseCase({ ...request, actionName: "decline" }),
    ).rejects.toMatchObject({
      isBoom: true,
      message:
        'Cannot perform action "decline" from agreement state "offered". Available actions: accept.',
      output: { statusCode: 409 },
    });

    expect(buildAgreementPageModel).not.toHaveBeenCalled();
  });

  it("preserves definition-version integrity failures", async () => {
    const error = Boom.badImplementation(
      'Agreement definition "pigs-might-fly" is version "0.0.2" but the Agreement uses version "0.0.1"',
    );
    agreementDefinition.resolveAction.mockImplementation(() => {
      throw error;
    });

    await expect(validateAgreementActionUseCase(request)).rejects.toBe(error);
    expect(buildAgreementPageModel).not.toHaveBeenCalled();
  });

  it("rejects duplicate accept using the latest snapshot state", async () => {
    loadCurrentAgreement.mockResolvedValue({
      ...currentAgreement,
      state: "accepted",
      item: { ...currentAgreement.item, state: "accepted" },
    });
    agreementDefinition.resolveAction.mockImplementation(() => {
      throw new InvalidAgreementTransitionError({
        from: "accepted",
        action: "accept",
        availableActions: ["terminate"],
      });
    });

    await expect(validateAgreementActionUseCase(request)).rejects.toMatchObject(
      {
        isBoom: true,
        output: { statusCode: 409 },
      },
    );

    expect(buildAgreementPageModel).not.toHaveBeenCalled();
  });

  it("returns non-disclosing not found when the URL identifies another Agreement", async () => {
    await expect(
      validateAgreementActionUseCase({
        ...request,
        agreementNumber: "PMF000000000",
      }),
    ).rejects.toMatchObject({
      isBoom: true,
      message: "Agreement not found",
      output: { statusCode: 404 },
    });

    expect(loadAgreementDefinition).not.toHaveBeenCalled();
    expect(buildAgreementPageModel).not.toHaveBeenCalled();
  });
});
