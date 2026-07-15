import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertAgreementPageAllowedForStatus,
  resolveAgreementPageForVersion,
  resolveAgreementPageMode,
} from "../models/agreement-definitions/agreement-definition-resolver.js";
import { AgreementReference } from "../models/agreement-reference.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import { resolveComponents } from "../services/resolve-components.js";
import { resolveActions } from "../services/resolve-page-href.js";
import { renderAgreementPageFromVersionUseCase } from "./render-agreement-page-from-version.use-case.js";
import { renderAgreementPageUseCase } from "./render-agreement-page.use-case.js";
import { resolveCurrentAgreementUseCase } from "./resolve-current-agreement.use-case.js";

vi.mock("../models/agreement-definitions/agreement-definition-resolver.js");
vi.mock("../services/resolve-components.js");
vi.mock("../services/resolve-page-href.js");
vi.mock("./resolve-current-agreement.use-case.js");

const reference = new AgreementReference({
  agreementNumber: "PMF823153883",
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
});

const item = {
  agreementCode: reference.code,
  clientRef: reference.clientRef,
  identifiers: { sbi: reference.sbi },
  configVersion: "0.0.1",
  status: "offered",
};

const snapshot = new Agreement({
  agreementNumber: reference.agreementNumber,
  code: reference.code,
  identifiers: { sbi: reference.sbi },
  items: [item],
});

const version = new AgreementVersion({
  agreementNumber: reference.agreementNumber,
  version: 2,
  snapshot,
});

const currentAgreement = { reference, version, item };

const pageDefinition = {
  title: "Review your agreement offer",
  components: [{ component: "heading", text: "Review" }],
  actions: [{ text: "Continue", href: "#confirm" }],
};

const renderRequest = {
  currentAgreement,
  page: "offered",
  mode: "view",
};

describe("renderAgreementPageFromVersionUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAgreementPageForVersion.mockReturnValue(pageDefinition);
    resolveAgreementPageMode.mockReturnValue("view");
    resolveComponents.mockResolvedValue(pageDefinition.components);
    resolveActions.mockResolvedValue(pageDefinition.actions);
  });

  it("renders from the supplied latest-version snapshot", async () => {
    await expect(
      renderAgreementPageFromVersionUseCase(renderRequest),
    ).resolves.toEqual({
      ...reference,
      status: "offered",
      page: {
        name: "offered",
        title: "Review your agreement offer",
        mode: "view",
      },
      components: pageDefinition.components,
      actions: pageDefinition.actions,
    });

    expect(assertAgreementPageAllowedForStatus).toHaveBeenCalledWith({
      code: reference.code,
      page: "offered",
      status: "offered",
      configVersion: "0.0.1",
    });
    expect(resolveComponents).toHaveBeenCalledWith(pageDefinition.components, {
      agreement: snapshot,
      snapshot,
      item,
    });
    expect(resolveActions).toHaveBeenCalledWith(
      { agreement: snapshot, snapshot, item },
      pageDefinition.actions,
    );
  });

  it("rejects a page unavailable in the latest lifecycle state", async () => {
    assertAgreementPageAllowedForStatus.mockImplementation(() => {
      throw Boom.forbidden("Page is unavailable");
    });

    await expect(
      renderAgreementPageFromVersionUseCase(renderRequest),
    ).rejects.toMatchObject({ output: { statusCode: 403 } });
    expect(resolveComponents).not.toHaveBeenCalled();
  });

  it("converts render-resolution failures into a controlled error", async () => {
    resolveComponents.mockRejectedValue(new Error("Missing value"));

    await expect(
      renderAgreementPageFromVersionUseCase(renderRequest),
    ).rejects.toThrow(
      'Unable to render page "offered" for agreement "PMF823153883"',
    );
  });
});

describe("renderAgreementPageUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveCurrentAgreementUseCase.mockResolvedValue(currentAgreement);
    resolveAgreementPageForVersion.mockReturnValue(pageDefinition);
    resolveAgreementPageMode.mockReturnValue("view");
    resolveComponents.mockResolvedValue(pageDefinition.components);
    resolveActions.mockResolvedValue(pageDefinition.actions);
  });

  it("renders the requested page from the resolved current version", async () => {
    await renderAgreementPageUseCase({
      code: reference.code,
      clientRef: reference.clientRef,
      sbi: reference.sbi,
      page: "offered",
      mode: "view",
    });

    expect(resolveCurrentAgreementUseCase).toHaveBeenCalledWith({
      code: reference.code,
      clientRef: reference.clientRef,
      sbi: reference.sbi,
    });
    expect(resolveComponents).toHaveBeenCalledWith(pageDefinition.components, {
      agreement: snapshot,
      snapshot,
      item,
    });
  });
});
