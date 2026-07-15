import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAgreementPageForStatus } from "../models/agreement-definitions/agreement-definition-resolver.js";
import { AgreementReference } from "../models/agreement-reference.js";
import { findCurrentAgreementUseCase } from "./find-current-agreement.use-case.js";
import { renderAgreementPageFromVersionUseCase } from "./render-agreement-page-from-version.use-case.js";
import { resolveCurrentAgreementUseCase } from "./resolve-current-agreement.use-case.js";

vi.mock("../models/agreement-definitions/agreement-definition-resolver.js");
vi.mock("./render-agreement-page-from-version.use-case.js");
vi.mock("./resolve-current-agreement.use-case.js");

const query = {
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
};

const reference = new AgreementReference({
  agreementNumber: "PMF823153883",
  ...query,
});

const currentAgreement = {
  reference,
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
    resolveCurrentAgreementUseCase.mockResolvedValue(currentAgreement);
    resolveAgreementPageForStatus.mockReturnValue({
      pageId: "active-agreement",
    });
    renderAgreementPageFromVersionUseCase.mockResolvedValue({
      ...reference,
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
      ...reference,
      status: "accepted",
      page: {
        name: "active-agreement",
        title: "Your agreement is active",
        mode: "view",
      },
      components: [{ component: "heading", text: "Active" }],
      actions: [],
    });

    expect(resolveCurrentAgreementUseCase).toHaveBeenCalledWith(query);
    expect(resolveAgreementPageForStatus).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      status: "accepted",
    });
    expect(renderAgreementPageFromVersionUseCase).toHaveBeenCalledWith({
      currentAgreement,
      page: "active-agreement",
      mode: "view",
    });
  });
});
