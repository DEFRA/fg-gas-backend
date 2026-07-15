import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertAgreementPageAllowedForStatus,
  resolveAgreementPage,
  resolveAgreementPageMode,
} from "../models/agreement-definitions/agreement-definition-resolver.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import { resolveComponents } from "../services/resolve-components.js";
import { resolveActions } from "../services/resolve-page-href.js";
import { renderAgreementPageFromVersion } from "./render-agreement-page-from-version.use-case.js";
import { renderAgreementPageUseCase } from "./render-agreement-page.use-case.js";
import { resolveCurrentAgreementByIdentity } from "./resolve-current-agreement.use-case.js";

vi.mock("../models/agreement-definitions/agreement-definition-resolver.js");
vi.mock("../services/resolve-components.js");
vi.mock("../services/resolve-page-href.js");
vi.mock("./resolve-current-agreement.use-case.js");

const identity = {
  agreementNumber: "PMF823153883",
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
};

const item = {
  agreementCode: identity.code,
  clientRef: identity.clientRef,
  configVersion: "0.0.1",
  status: "offered",
};

const snapshot = new Agreement({
  agreementNumber: identity.agreementNumber,
  code: identity.code,
  identifiers: { sbi: identity.sbi },
  items: [item],
});

const version = new AgreementVersion({
  agreementNumber: identity.agreementNumber,
  version: 2,
  snapshot,
});

const pageDefinition = {
  title: "Review your agreement offer",
  components: [{ component: "heading", text: "Review" }],
  actions: [{ text: "Continue", href: "#confirm" }],
};

const renderRequest = {
  version,
  identity,
  page: "offered",
  mode: "view",
};

describe("renderAgreementPageFromVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAgreementPage.mockReturnValue(pageDefinition);
    resolveAgreementPageMode.mockReturnValue("view");
    resolveComponents.mockResolvedValue(pageDefinition.components);
    resolveActions.mockResolvedValue(pageDefinition.actions);
  });

  it("renders from the supplied latest-version snapshot", async () => {
    await expect(
      renderAgreementPageFromVersion(renderRequest),
    ).resolves.toEqual({
      ...identity,
      status: "offered",
      page: {
        name: "offered",
        title: "Review your agreement offer",
        mode: "view",
      },
      components: pageDefinition.components,
      actions: pageDefinition.actions,
    });

    expect(assertAgreementPageAllowedForStatus).toHaveBeenCalledWith(
      identity.code,
      "offered",
      "offered",
    );
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

  it.each([
    ["agreement number", { agreementNumber: "PMF000000000" }],
    ["code", { code: "another-code" }],
    ["SBI", { identifiers: { sbi: "999999999" } }],
    ["item", { items: [] }],
  ])("rejects an inconsistent snapshot %s", async (_name, override) => {
    await expect(
      renderAgreementPageFromVersion({
        ...renderRequest,
        version: new AgreementVersion({
          ...version,
          snapshot: new Agreement({ ...snapshot, ...override }),
        }),
      }),
    ).rejects.toMatchObject({ output: { statusCode: 500 } });

    expect(resolveAgreementPage).not.toHaveBeenCalled();
    expect(resolveComponents).not.toHaveBeenCalled();
  });

  it("rejects a page unavailable in the latest lifecycle state", async () => {
    assertAgreementPageAllowedForStatus.mockImplementation(() => {
      throw Boom.forbidden("Page is unavailable");
    });

    await expect(
      renderAgreementPageFromVersion(renderRequest),
    ).rejects.toMatchObject({ output: { statusCode: 403 } });
    expect(resolveComponents).not.toHaveBeenCalled();
  });

  it("converts render-resolution failures into a controlled error", async () => {
    resolveComponents.mockRejectedValue(new Error("Missing value"));

    await expect(renderAgreementPageFromVersion(renderRequest)).rejects.toThrow(
      'Unable to render page "offered" for agreement "PMF823153883"',
    );
  });
});

describe("renderAgreementPageUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveCurrentAgreementByIdentity.mockResolvedValue({
      identity,
      version,
      item,
    });
    resolveAgreementPage.mockReturnValue(pageDefinition);
    resolveAgreementPageMode.mockReturnValue("view");
    resolveComponents.mockResolvedValue(pageDefinition.components);
    resolveActions.mockResolvedValue(pageDefinition.actions);
  });

  it("renders the requested page from the resolved current version", async () => {
    await renderAgreementPageUseCase({
      code: identity.code,
      clientRef: identity.clientRef,
      sbi: identity.sbi,
      page: "offered",
      mode: "view",
    });

    expect(resolveCurrentAgreementByIdentity).toHaveBeenCalledWith({
      code: identity.code,
      clientRef: identity.clientRef,
      sbi: identity.sbi,
    });
    expect(resolveComponents).toHaveBeenCalledWith(pageDefinition.components, {
      agreement: snapshot,
      snapshot,
      item,
    });
  });
});
