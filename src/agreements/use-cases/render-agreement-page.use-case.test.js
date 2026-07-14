import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertAgreementPageAllowedForStatus,
  resolveAgreementPage,
  resolveAgreementPageMode,
} from "../models/agreement-definitions/agreement-definition-resolver.js";
import {
  findByClientRefCodeAndSbi,
  findLatestVersionByAgreementNumber,
} from "../repositories/agreement.repository.js";
import { resolveComponents } from "../services/resolve-components.js";
import { resolveActions } from "../services/resolve-page-href.js";
import { renderAgreementPageUseCase } from "./render-agreement-page.use-case.js";

vi.mock("../models/agreement-definitions/agreement-definition-resolver.js");
vi.mock("../repositories/agreement.repository.js");
vi.mock("../services/resolve-components.js");
vi.mock("../services/resolve-page-href.js");

const query = {
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
  page: "offered",
  mode: "view",
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

const snapshotItem = {
  agreementCode: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  supplementaryData: {
    fundingCalculation: {
      items: [{ description: "Large White", total: 320 }],
    },
  },
};

const snapshot = { items: [snapshotItem] };

const version = { agreementNumber: "PMF823153883", version: 1, snapshot };

describe("renderAgreementPageUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the offered page with resolved components, payment data and actions", async () => {
    const pageDefinition = {
      title: "Review your agreement offer",
      components: [{ component: "table", rowsRef: "$.snapshot.items[0]" }],
      actions: [{ text: "Continue", href: "#confirm" }],
    };

    resolveAgreementPage.mockReturnValue(pageDefinition);
    resolveAgreementPageMode.mockReturnValue("view");
    findByClientRefCodeAndSbi.mockResolvedValue(agreement);
    findLatestVersionByAgreementNumber.mockResolvedValue(version);
    resolveComponents.mockResolvedValue([
      {
        component: "table",
        rows: [[{ text: "Large White" }, { text: "£320" }]],
      },
    ]);
    resolveActions.mockResolvedValue([
      { text: "Continue", href: "/PMF823153883/accept" },
    ]);

    const result = await renderAgreementPageUseCase(query);

    expect(resolveAgreementPage).toHaveBeenCalledWith(
      "pigs-might-fly",
      "offered",
    );
    expect(resolveAgreementPageMode).toHaveBeenCalledWith("view");
    expect(findByClientRefCodeAndSbi).toHaveBeenCalledWith(
      "xnp-rr3-nfa",
      "pigs-might-fly",
      "300000069",
    );
    expect(findLatestVersionByAgreementNumber).toHaveBeenCalledWith(
      "PMF823153883",
    );
    expect(resolveComponents).toHaveBeenCalledWith(pageDefinition.components, {
      agreement,
      snapshot,
      item: snapshotItem,
    });
    expect(resolveActions).toHaveBeenCalledWith(
      { agreement, snapshot, item: snapshotItem },
      pageDefinition.actions,
    );
    expect(result).toEqual({
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
      status: "offered",
      page: {
        name: "offered",
        title: "Review your agreement offer",
        mode: "view",
      },
      components: [
        {
          component: "table",
          rows: [[{ text: "Large White" }, { text: "£320" }]],
        },
      ],
      actions: [{ text: "Continue", href: "/PMF823153883/accept" }],
    });
  });

  it("renders the accepted page as read-only with no actions", async () => {
    const pageDefinition = {
      title: "Your agreement is now active",
      components: [{ component: "heading", level: 1, text: "Active" }],
      actions: [],
    };

    resolveAgreementPage.mockReturnValue(pageDefinition);
    resolveAgreementPageMode.mockReturnValue("view");
    findByClientRefCodeAndSbi.mockResolvedValue({
      ...agreement,
      items: [{ ...agreement.items[0], status: "accepted" }],
    });
    findLatestVersionByAgreementNumber.mockResolvedValue(version);
    resolveComponents.mockResolvedValue(pageDefinition.components);
    resolveActions.mockResolvedValue([]);

    const result = await renderAgreementPageUseCase({
      ...query,
      page: "accepted",
    });

    expect(result.status).toBe("accepted");
    expect(result.actions).toEqual([]);
  });

  it("throws the controlled error for an unsupported page without touching the database", async () => {
    resolveAgreementPage.mockImplementation(() => {
      throw Boom.notFound(
        'Unknown page "bogus" for agreement code "pigs-might-fly"',
      );
    });

    await expect(
      renderAgreementPageUseCase({ ...query, page: "bogus" }),
    ).rejects.toThrow('Unknown page "bogus"');

    expect(findByClientRefCodeAndSbi).not.toHaveBeenCalled();
    expect(findLatestVersionByAgreementNumber).not.toHaveBeenCalled();
  });

  it("throws the controlled error for an unsupported mode without touching the database", async () => {
    resolveAgreementPage.mockReturnValue({
      title: "Review your agreement offer",
      components: [],
      actions: [],
    });
    resolveAgreementPageMode.mockImplementation(() => {
      throw Boom.notFound('Unsupported mode "document"');
    });

    await expect(
      renderAgreementPageUseCase({ ...query, mode: "document" }),
    ).rejects.toThrow('Unsupported mode "document"');

    expect(findByClientRefCodeAndSbi).not.toHaveBeenCalled();
    expect(findLatestVersionByAgreementNumber).not.toHaveBeenCalled();
  });

  it("throws Boom.notFound when no agreement matches the supplied identity", async () => {
    resolveAgreementPage.mockReturnValue({
      title: "Review your agreement offer",
      components: [],
      actions: [],
    });
    resolveAgreementPageMode.mockReturnValue("view");
    findByClientRefCodeAndSbi.mockResolvedValue(null);

    await expect(renderAgreementPageUseCase(query)).rejects.toThrow(
      Boom.notFound(
        'Agreement not found for code "pigs-might-fly", clientRef "xnp-rr3-nfa" and sbi "300000069"',
      ),
    );
    expect(findLatestVersionByAgreementNumber).not.toHaveBeenCalled();
  });

  it("throws Boom.forbidden when the requested page is not valid for the agreement's current status, without touching version data", async () => {
    resolveAgreementPage.mockReturnValue({
      title: "Review your agreement offer",
      components: [],
      actions: [],
    });
    resolveAgreementPageMode.mockReturnValue("view");
    findByClientRefCodeAndSbi.mockResolvedValue({
      ...agreement,
      items: [{ ...agreement.items[0], status: "accepted" }],
    });
    assertAgreementPageAllowedForStatus.mockImplementation(() => {
      throw Boom.forbidden(
        'Page "offered" is not valid for agreement code "pigs-might-fly" in state "accepted"',
      );
    });

    await expect(renderAgreementPageUseCase(query)).rejects.toThrow(
      'Page "offered" is not valid for agreement code "pigs-might-fly" in state "accepted"',
    );

    expect(assertAgreementPageAllowedForStatus).toHaveBeenCalledWith(
      "pigs-might-fly",
      "offered",
      "accepted",
    );
    expect(findLatestVersionByAgreementNumber).not.toHaveBeenCalled();
  });

  it("throws Boom.notFound when no version snapshot exists for the agreement", async () => {
    resolveAgreementPage.mockReturnValue({
      title: "Review your agreement offer",
      components: [],
      actions: [],
    });
    resolveAgreementPageMode.mockReturnValue("view");
    findByClientRefCodeAndSbi.mockResolvedValue(agreement);
    findLatestVersionByAgreementNumber.mockResolvedValue(null);

    await expect(renderAgreementPageUseCase(query)).rejects.toThrow(
      Boom.notFound('No version snapshot found for agreement "PMF823153883"'),
    );
    expect(resolveComponents).not.toHaveBeenCalled();
  });

  it("throws Boom.notFound when the version snapshot has no item matching the code and clientRef", async () => {
    resolveAgreementPage.mockReturnValue({
      title: "Review your agreement offer",
      components: [],
      actions: [],
    });
    resolveAgreementPageMode.mockReturnValue("view");
    findByClientRefCodeAndSbi.mockResolvedValue(agreement);
    findLatestVersionByAgreementNumber.mockResolvedValue({
      ...version,
      snapshot: { items: [] },
    });

    await expect(renderAgreementPageUseCase(query)).rejects.toThrow(
      Boom.notFound(
        'No version snapshot item found for agreement "PMF823153883", code "pigs-might-fly" and clientRef "xnp-rr3-nfa"',
      ),
    );
    expect(resolveComponents).not.toHaveBeenCalled();
  });

  it("converts a render-resolution failure into a controlled Boom error instead of leaking the raw error", async () => {
    resolveAgreementPage.mockReturnValue({
      title: "Review your agreement offer",
      components: [{ component: "table", rowsRef: "$.item.missing" }],
      actions: [],
    });
    resolveAgreementPageMode.mockReturnValue("view");
    findByClientRefCodeAndSbi.mockResolvedValue(agreement);
    findLatestVersionByAgreementNumber.mockResolvedValue(version);
    resolveComponents.mockRejectedValue(
      new Error('Unresolved reference "$.item.missing" in effect params'),
    );
    resolveActions.mockResolvedValue([]);

    await expect(renderAgreementPageUseCase(query)).rejects.toThrow(
      Boom.badImplementation(
        'Unable to render page "offered" for agreement "PMF823153883"',
      ),
    );
  });
});
