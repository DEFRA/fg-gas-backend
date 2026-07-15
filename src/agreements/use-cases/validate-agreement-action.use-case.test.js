import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgreementAction } from "../models/agreement-action.js";
import { resolveAgreementActionForVersion } from "../models/agreement-definitions/agreement-definition-resolver.js";
import { InvalidAgreementTransitionError } from "../models/invalid-agreement-transition.error.js";
import { renderAgreementPageFromVersionUseCase } from "./render-agreement-page-from-version.use-case.js";
import { resolveCurrentAgreementUseCase } from "./resolve-current-agreement.use-case.js";
import { validateAgreementActionUseCase } from "./validate-agreement-action.use-case.js";

vi.mock("../models/agreement-definitions/agreement-definition-resolver.js");
vi.mock("./render-agreement-page-from-version.use-case.js");
vi.mock("./resolve-current-agreement.use-case.js");

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
    status: "offered",
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

describe("validateAgreementActionUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveCurrentAgreementUseCase.mockResolvedValue(currentAgreement);
    resolveAgreementActionForVersion.mockReturnValue(acceptAction);
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

    expect(resolveCurrentAgreementUseCase).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
    });
    expect(resolveAgreementActionForVersion).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      state: "offered",
      action: "accept",
      configVersion: "0.0.1",
    });
    expect(renderAgreementPageFromVersionUseCase).not.toHaveBeenCalled();
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
    resolveAgreementActionForVersion.mockReturnValue(identityNamedAction);

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

    expect(renderAgreementPageFromVersionUseCase).not.toHaveBeenCalled();
  });

  it("returns the configured validation page with exact field errors", async () => {
    const renderModel = {
      ...currentAgreement.reference,
      status: "offered",
      page: {
        name: "accept",
        title: "Accept your agreement offer",
        mode: "view",
      },
      components: [],
      actions: [],
    };
    renderAgreementPageFromVersionUseCase.mockResolvedValue(renderModel);

    await expect(
      validateAgreementActionUseCase({
        ...request,
        values: { ...request.values, confirm: undefined },
      }),
    ).resolves.toEqual({
      ...renderModel,
      errors: [
        {
          name: "confirm",
          href: "#confirm",
          message: "Confirm this agreement offer before accepting it",
        },
      ],
    });

    expect(renderAgreementPageFromVersionUseCase).toHaveBeenCalledWith({
      currentAgreement,
      page: "accept",
      mode: "view",
    });
  });

  it("maps an unsupported action to a specific conflict", async () => {
    resolveAgreementActionForVersion.mockImplementation(() => {
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

    expect(renderAgreementPageFromVersionUseCase).not.toHaveBeenCalled();
  });

  it("preserves definition-version integrity failures", async () => {
    const error = Boom.badImplementation(
      'Agreement definition "pigs-might-fly" is version "0.0.2" but the Agreement uses version "0.0.1"',
    );
    resolveAgreementActionForVersion.mockImplementation(() => {
      throw error;
    });

    await expect(validateAgreementActionUseCase(request)).rejects.toBe(error);
    expect(renderAgreementPageFromVersionUseCase).not.toHaveBeenCalled();
  });

  it("rejects duplicate accept using the latest snapshot state", async () => {
    resolveCurrentAgreementUseCase.mockResolvedValue({
      ...currentAgreement,
      item: { ...currentAgreement.item, status: "accepted" },
    });
    resolveAgreementActionForVersion.mockImplementation(() => {
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

    expect(renderAgreementPageFromVersionUseCase).not.toHaveBeenCalled();
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

    expect(resolveAgreementActionForVersion).not.toHaveBeenCalled();
    expect(renderAgreementPageFromVersionUseCase).not.toHaveBeenCalled();
  });
});
