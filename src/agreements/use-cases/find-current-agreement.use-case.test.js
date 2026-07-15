import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAgreementPageForStatus } from "../models/agreement-definitions/agreement-definition-resolver.js";
import { findCurrentAgreementUseCase } from "./find-current-agreement.use-case.js";
import { renderAgreementPageFromVersion } from "./render-agreement-page-from-version.use-case.js";
import { resolveCurrentAgreementByIdentity } from "./resolve-current-agreement.use-case.js";

vi.mock("../models/agreement-definitions/agreement-definition-resolver.js");
vi.mock("./render-agreement-page-from-version.use-case.js");
vi.mock("./resolve-current-agreement.use-case.js");

const query = {
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
};

const identity = {
  agreementNumber: "PMF823153883",
  ...query,
};

const currentAgreement = {
  identity,
  version: { version: 2, snapshot: {} },
  item: {
    agreementCode: query.code,
    clientRef: query.clientRef,
    configVersion: "0.0.1",
    status: "accepted",
  },
};

describe("findCurrentAgreementUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveCurrentAgreementByIdentity.mockResolvedValue(currentAgreement);
    resolveAgreementPageForStatus.mockReturnValue({
      pageId: "active-agreement",
    });
    renderAgreementPageFromVersion.mockResolvedValue({
      ...identity,
      status: "accepted",
      page: {
        name: "active-agreement",
        title: "Your agreement is active",
        mode: "view",
      },
      components: [{ component: "heading", text: "Active" }],
      actions: [],
    });
  });

  it("renders the page configured for the latest Agreement item state", async () => {
    await expect(findCurrentAgreementUseCase(query)).resolves.toEqual({
      ...identity,
      status: "accepted",
      page: {
        name: "active-agreement",
        title: "Your agreement is active",
        mode: "view",
      },
      components: [{ component: "heading", text: "Active" }],
      actions: [],
    });

    expect(resolveCurrentAgreementByIdentity).toHaveBeenCalledWith(query);
    expect(resolveAgreementPageForStatus).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      status: "accepted",
      configVersion: "0.0.1",
    });
    expect(renderAgreementPageFromVersion).toHaveBeenCalledWith({
      version: currentAgreement.version,
      identity,
      page: "active-agreement",
      mode: "view",
    });
  });

  it("does not render when the definition resolver rejects the stored config version", async () => {
    resolveAgreementPageForStatus.mockImplementation(() => {
      throw Boom.badImplementation(
        'Agreement definition "pigs-might-fly" is version "0.0.2" but the Agreement uses version "0.0.1"',
      );
    });

    await expect(findCurrentAgreementUseCase(query)).rejects.toMatchObject({
      output: { statusCode: 500 },
    });
    expect(renderAgreementPageFromVersion).not.toHaveBeenCalled();
  });
});
