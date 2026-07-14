import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAgreementPage } from "../models/agreement-definitions/agreement-definition-resolver.js";
import { findByClientRefCodeAndSbi } from "../repositories/agreement.repository.js";
import { findCurrentAgreementUseCase } from "./find-current-agreement.use-case.js";

vi.mock("../models/agreement-definitions/agreement-definition-resolver.js");
vi.mock("../repositories/agreement.repository.js");

const query = {
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
};

const agreement = {
  agreementNumber: "PMF823153883",
  code: "pigs-might-fly",
  items: [
    {
      agreementCode: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      status: "offered",
    },
  ],
};

describe("findCurrentAgreementUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a UI representation of the current agreement when found", async () => {
    findByClientRefCodeAndSbi.mockResolvedValue(agreement);
    resolveAgreementPage.mockReturnValue({
      title: "Review your agreement offer",
      components: [{ component: "heading", level: 1, text: "Review" }],
      actions: [{ text: "Continue", href: "#confirm" }],
    });

    const result = await findCurrentAgreementUseCase(query);

    expect(findByClientRefCodeAndSbi).toHaveBeenCalledWith(
      "xnp-rr3-nfa",
      "pigs-might-fly",
      "300000069",
    );
    expect(resolveAgreementPage).toHaveBeenCalledWith(
      "pigs-might-fly",
      "offered",
    );
    expect(result).toEqual({
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
      status: "offered",
      page: { title: "Review your agreement offer" },
      components: [{ component: "heading", level: 1, text: "Review" }],
      actions: [{ text: "Continue", href: "#confirm" }],
    });
  });

  it("resolves templated action hrefs against the found agreement", async () => {
    findByClientRefCodeAndSbi.mockResolvedValue(agreement);
    resolveAgreementPage.mockReturnValue({
      title: "Review your agreement offer",
      components: [],
      actions: [
        {
          text: "Continue",
          href: {
            urlTemplate: "/{agreementNumber}/accept",
            params: { agreementNumber: "$.agreement.agreementNumber" },
          },
        },
      ],
    });

    const result = await findCurrentAgreementUseCase(query);

    expect(result.actions).toEqual([
      { text: "Continue", href: "/PMF823153883/accept" },
    ]);
  });

  it("throws Boom.notFound when no agreement matches the supplied identity", async () => {
    findByClientRefCodeAndSbi.mockResolvedValue(null);

    await expect(findCurrentAgreementUseCase(query)).rejects.toThrow(
      Boom.notFound(
        'Agreement not found for code "pigs-might-fly", clientRef "xnp-rr3-nfa" and sbi "300000069"',
      ),
    );
    expect(resolveAgreementPage).not.toHaveBeenCalled();
  });

  it("throws Boom.notFound when the agreement is found but no item matches the code and clientRef", async () => {
    findByClientRefCodeAndSbi.mockResolvedValue({
      ...agreement,
      items: [{ agreementCode: "some-other-code", clientRef: "xnp-rr3-nfa" }],
    });

    await expect(findCurrentAgreementUseCase(query)).rejects.toThrow(
      Boom.notFound(
        'Agreement not found for code "pigs-might-fly", clientRef "xnp-rr3-nfa" and sbi "300000069"',
      ),
    );
    expect(resolveAgreementPage).not.toHaveBeenCalled();
  });
});
